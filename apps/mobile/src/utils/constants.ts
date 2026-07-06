import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

/**
 * Persistent directory for recording audio files and session manifests.
 *
 * We write to `documentDirectory` (not `cacheDirectory`) because audio must
 * survive app kills, OS memory pressure, and reboots. This is the PRD's
 * non-negotiable #1 — zero recording loss on crash/kill/interruption.
 */
export const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

/**
 * Local manifest file — a JSON array of all Recording objects known to the
 * device. This is the source of truth for sync state on-device (per the
 * client-driven sync ADR in the README).
 */
export const MANIFEST_FILE = `${FileSystem.documentDirectory}recordings-manifest.json`;

/**
 * Extension for in-progress session manifest files. One `.session.json` is
 * written per active recording at start, and deleted on graceful stop. If the
 * app crashes, these files linger and `recoverInterruptedSessions()` picks
 * them up on next launch.
 */
export const SESSION_SUFFIX = ".session.json";

/**
 * MIME type for audio recordings.
 *
 * iOS: WAV (LINEARPCM) — crash-safe. Headers are at the start of the file, so
 * even a force-killed recording is playable on recovery.
 *
 * Android: AAC in MP4 container — accepted risk that a truncated file from a
 * crash is unplayable (moov atom is written at the end). The friendly error
 * message in the detail screen covers this.
 */
export const AUDIO_MIME_TYPE =
  Platform.OS === "ios" ? "audio/wav" : "audio/mp4";

/** File extension for recordings (`.wav` on iOS, `.m4a` on Android). */
export const AUDIO_EXTENSION = Platform.OS === "ios" ? ".wav" : ".m4a";

/** Ensure the recordings directory exists. Safe to call multiple times. */
export async function ensureRecordingsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, {
      intermediates: true,
    });
  }
}

/** Generate a UUID v4 (no external dependency needed). */
export function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
