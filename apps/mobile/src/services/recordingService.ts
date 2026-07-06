import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import type {
  RecordingOptions,
  RecordingStatus,
} from "expo-av/build/Audio/Recording.types";
import * as FileSystem from "expo-file-system";
import {
  AUDIO_EXTENSION,
  ensureRecordingsDir,
  generateId,
  RECORDINGS_DIR,
  SESSION_SUFFIX,
} from "../utils/constants";

// ---------------------------------------------------------------------------
// Mobile recording service (T-010)
//
// Wraps expo-av's Audio.Recording with:
//   - Mic permission handling
//   - Single-file-with-gaps pause/resume (one audio file per session)
//   - Durable writes to documentDirectory (not cache)
//   - Session manifest for crash recovery (T-012)
//   - Metering + duration status callbacks
//
// State machine: idle → recording ↔ paused → stopped → idle
// ---------------------------------------------------------------------------

/** Callback receiving live status updates. */
export interface RecordingStatusUpdate {
  state: RecordingState;
  durationMs: number;
  /** Audio metering level (dB), or undefined if not available. */
  metering?: number;
}

export type RecordingState =
  | "idle"
  | "recording"
  | "paused"
  | "stopped"
  | "error";

/** Custom options: AAC/m4a, mono, 44.1 kHz, 96 kbps (voice-suitable). */
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: AUDIO_EXTENSION,
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 96000,
  },
  ios: {
    extension: AUDIO_EXTENSION,
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 96000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 96000,
  },
};

/** Session manifest written to disk for crash recovery (T-012). */
export interface SessionManifest {
  id: string;
  audioPath: string;
  startedAt: string;
  status: "recording" | "paused";
}

export class RecordingService {
  private recording: Audio.Recording | null = null;
  private state: RecordingState = "idle";
  private sessionId: string | null = null;
  private audioPath: string | null = null;
  private startTimestamp: number = 0;
  private onStatusUpdate: ((update: RecordingStatusUpdate) => void) | null =
    null;

  /** Subscribe to status updates. */
  setStatusCallback(cb: (update: RecordingStatusUpdate) => void): void {
    this.onStatusUpdate = cb;
  }

  getState(): RecordingState {
    return this.state;
  }

  /** Request microphone recording permissions. */
  async requestPermissions(): Promise<boolean> {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  }

  /** Configure audio mode for recording. */
  private async configureAudioMode(): Promise<void> {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  }

  /**
   * Start a new recording session.
   *
   * Creates the audio file in a persistent directory immediately, writes a
   * session manifest for crash recovery, and begins capturing.
   */
  async start(sessionId?: string): Promise<string> {
    if (this.recording) {
      throw new Error("Recording already in progress");
    }

    const granted = await this.requestPermissions();
    if (!granted) {
      throw new Error("Microphone permission not granted");
    }

    await this.configureAudioMode();
    await ensureRecordingsDir();

    this.sessionId = sessionId ?? generateId();
    this.audioPath = `${RECORDINGS_DIR}${this.sessionId}${AUDIO_EXTENSION}`;

    // Create the recording instance
    this.recording = new Audio.Recording();
    this.recording.setOnRecordingStatusUpdate((status: RecordingStatus) => {
      this.emitStatus(status);
    });

    // Prepare and start — the audio file is created in the persistent dir
    await this.recording.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
    this.startTimestamp = Date.now();
    await this.recording.startAsync();

    this.state = "recording";

    // Write session manifest for crash recovery (T-012)
    await this.writeSessionManifest();

    return this.sessionId;
  }

  /** Pause recording (single-file-with-gaps — does not create a new file). */
  async pause(): Promise<void> {
    if (!this.recording || this.state !== "recording") {
      throw new Error("Not currently recording");
    }
    await this.recording.pauseAsync();
    this.state = "paused";

    // Update session manifest
    await this.writeSessionManifest();
  }

  /** Resume recording after a pause. */
  async resume(): Promise<void> {
    if (!this.recording || this.state !== "paused") {
      throw new Error("Not paused");
    }
    await this.recording.startAsync();
    this.state = "recording";

    // Update session manifest
    await this.writeSessionManifest();
  }

  /**
   * Stop and finalize the recording.
   *
   * Returns the audio file URI and duration. The session manifest is deleted
   * on graceful stop — if the app crashes before this, the manifest persists
   * and `recoverInterruptedSessions()` picks it up on next launch.
   */
  async stop(): Promise<{
    sessionId: string;
    uri: string;
    durationMs: number;
    fileSizeBytes: number;
  }> {
    if (!this.recording || this.state === "idle" || this.state === "stopped") {
      throw new Error("No active recording to stop");
    }

    if (!this.sessionId || !this.audioPath) {
      throw new Error("Recording session state lost");
    }

    const sessionId = this.sessionId;

    const status = await this.recording.stopAndUnloadAsync();
    const uri = this.recording.getURI();
    // expo-av's durationMillis can return 0 across some SDK/device combos.
    // Fall back to wall-clock elapsed so the UI never shows 0:00.
    const elapsedMs = Date.now() - this.startTimestamp;
    const durationMs =
      (status.durationMillis ?? 0) > 0
        ? status.durationMillis!
        : elapsedMs;

    if (!uri) {
      throw new Error("Recording produced no audio file");
    }

    // Get file size
    let fileSizeBytes = 0;
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        fileSizeBytes = (info as { size?: number }).size ?? 0;
      }
    } catch {
      // Non-fatal — file size is best-effort
    }

    // Delete session manifest (graceful stop — no recovery needed)
    await this.removeSessionManifest();

    this.state = "stopped";
    this.reset();

    return { sessionId, uri, durationMs, fileSizeBytes };
  }

  /** Cancel the recording without saving — deletes the audio file + manifest. */
  async cancel(): Promise<void> {
    if (!this.recording) {
      this.reset();
      return;
    }

    try {
      await this.recording.stopAndUnloadAsync();
    } catch {
      // Recording may already be stopped
    }

    // Delete the audio file
    if (this.audioPath) {
      try {
        const info = await FileSystem.getInfoAsync(this.audioPath);
        if (info.exists) {
          await FileSystem.deleteAsync(this.audioPath, {
            idempotent: true,
          });
        }
      } catch {
        // Best-effort cleanup
      }
    }

    await this.removeSessionManifest();
    this.reset();
  }

  /** Clean up resources. Safe to call multiple times. */
  async cleanup(): Promise<void> {
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch {
        // Already stopped or not started
      }
      this.recording = null;
    }
    this.reset();
  }

  // -----------------------------------------------------------------
  // Session manifest (durability — T-012)
  // -----------------------------------------------------------------

  private getSessionManifestPath(): string {
    if (!this.sessionId) {
      throw new Error("No session id");
    }
    return `${RECORDINGS_DIR}${this.sessionId}${SESSION_SUFFIX}`;
  }

  private async writeSessionManifest(): Promise<void> {
    if (!this.sessionId || !this.audioPath) return;
    const manifest: SessionManifest = {
      id: this.sessionId,
      audioPath: this.audioPath,
      startedAt: new Date().toISOString(),
      status: this.state === "paused" ? "paused" : "recording",
    };
    try {
      await ensureRecordingsDir();
      await FileSystem.writeAsStringAsync(
        this.getSessionManifestPath(),
        JSON.stringify(manifest, null, 2),
      );
    } catch (err) {
      // Non-fatal — manifest is best-effort for crash recovery
      console.warn("[recording] failed to write session manifest:", err);
    }
  }

  private async removeSessionManifest(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const path = this.getSessionManifestPath();
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    } catch {
      // Best-effort
    }
  }

  // -----------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------

  private emitStatus(status: RecordingStatus): void {
    if (!this.onStatusUpdate) return;
    this.onStatusUpdate({
      state: this.state,
      durationMs: status.durationMillis ?? 0,
      metering: status.metering,
    });
  }

  private reset(): void {
    this.recording = null;
    this.sessionId = null;
    this.audioPath = null;
    this.state = "idle";
  }
}

/** Singleton instance for app-wide use. */
export const recordingService = new RecordingService();
