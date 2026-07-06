import * as FileSystem from "expo-file-system";

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

/** MIME type for the chosen audio format (AAC in m4a container). */
export const AUDIO_MIME_TYPE = "audio/mp4";

/** File extension for recordings. */
export const AUDIO_EXTENSION = ".m4a";

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
