import type { Recording } from "@interview-recorder/shared";
import * as FileSystem from "expo-file-system";
import {
  AUDIO_MIME_TYPE,
  ensureRecordingsDir,
  RECORDINGS_DIR,
  SESSION_SUFFIX,
} from "../utils/constants";
import { currentUserId, getRecording, upsertRecording } from "./localStore";
import type { SessionManifest } from "./recordingService";

// ---------------------------------------------------------------------------
// Capture durability — crash recovery (T-012)
//
// PRD non-negotiable #1: zero recording loss on crash/kill/interruption.
// The partial audio must be recoverable from local storage on next launch.
//
// Strategy:
//   1. When a recording starts, RecordingService writes a `.session.json`
//      manifest alongside the audio file (in persistent documentDirectory).
//   2. On graceful stop, the manifest is deleted.
//   3. On app launch (or any time this function is called), scan the
//      recordings directory for lingering `.session.json` files. Each one
//      represents a recording that was interrupted (crash, kill, OS memory
//      pressure). Finalize it: create a local Recording entry with status
//      `local` pointing to the partial audio file, then delete the manifest.
//   4. The sync engine (T-015) will then pick up these `local` recordings
//      and attempt upload normally.
// ---------------------------------------------------------------------------

export interface RecoveredSession {
  recordingId: string;
  audioPath: string;
  durationMs: number;
  recovered: boolean;
}

/**
 * Scan the recordings directory for interrupted sessions and recover them.
 *
 * Call this on app launch. Safe to call multiple times — re-running on an
 * already-recovered session is a no-op (the manifest is deleted after
 * recovery, and a recording with the same id already exists in the local
 * store).
 */
export async function recoverInterruptedSessions(): Promise<
  RecoveredSession[]
> {
  await ensureRecordingsDir();

  const files = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
  const sessionFiles = files.filter((f) => f.endsWith(SESSION_SUFFIX));

  if (sessionFiles.length === 0) {
    return [];
  }

  const recovered: RecoveredSession[] = [];

  for (const sessionFile of sessionFiles) {
    try {
      const sessionPath = `${RECORDINGS_DIR}${sessionFile}`;
      const raw = await FileSystem.readAsStringAsync(sessionPath);
      const manifest = JSON.parse(raw) as SessionManifest;

      // Check if the audio file actually exists
      const audioInfo = await FileSystem.getInfoAsync(manifest.audioPath);
      if (!audioInfo.exists) {
        // Audio file missing — clean up the orphaned manifest and move on
        await FileSystem.deleteAsync(sessionPath, { idempotent: true });
        continue;
      }

      // Check if already recovered (recording exists in local store)
      const existing = await getRecording(manifest.id);
      if (existing) {
        // Already recovered — clean up manifest
        await FileSystem.deleteAsync(sessionPath, { idempotent: true });
        continue;
      }

      // Get the file size as a best-effort duration proxy
      const fileSizeBytes = (audioInfo as { size?: number }).size ?? 0;

      // Create a Recording entry for the partial audio
      const now = new Date().toISOString();
      const recording: Recording = {
        id: manifest.id,
        userId: currentUserId ?? "",

        title: "Recovered Recording",
        intervieweeName: "Unknown",
        role: undefined,
        tags: [],
        notes: "Recovered after an interruption.",
        durationMs: 0, // Unknown until playback reads metadata; sync fills it
        fileSizeBytes,
        mimeType: AUDIO_MIME_TYPE,
        status: "local",
        s3Key: null,
        localUri: manifest.audioPath,
        createdAt: manifest.startedAt,
        updatedAt: now,
      };

      await upsertRecording(recording);

      // Delete the session manifest — recovery is complete
      await FileSystem.deleteAsync(sessionPath, { idempotent: true });

      recovered.push({
        recordingId: manifest.id,
        audioPath: manifest.audioPath,
        durationMs: 0,
        recovered: true,
      });
    } catch (err) {
      console.warn(
        `[durability] failed to recover session ${sessionFile}:`,
        err,
      );
    }
  }

  return recovered;
}

/**
 * Full app-launch recovery sequence:
 *   1. Recover interrupted sessions (crash/kill during recording)
 *   2. Reset any recordings stuck in `uploading` back to `local`
 *
 * This should be called once on app launch, before the UI renders.
 */
export async function performAppLaunchRecovery(): Promise<{
  recovered: RecoveredSession[];
  stuckUploadsReset: number;
}> {
  const recovered = await recoverInterruptedSessions();
  const { resetStuckUploading } = await import("./localStore");
  const stuckUploadsReset = await resetStuckUploading();
  return { recovered, stuckUploadsReset };
}
