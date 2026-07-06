import * as FileSystem from "expo-file-system";
import type { Recording, SyncStatus } from "@interview-recorder/shared";
import { MANIFEST_FILE, ensureRecordingsDir } from "../utils/constants";

// ---------------------------------------------------------------------------
// Mobile local storage repository (T-013)
//
// A JSON manifest file in documentDirectory stores all recordings known to
// the device. It survives relaunches and is the on-device source of truth for
// the sync engine. Update the items in place and persist the whole array on
// each mutation — the dataset is small (tens to low-hundreds of recordings),
// so a single-file JSON manifest is adequate for the MVP.
// ---------------------------------------------------------------------------

/** Read the entire manifest into memory. */
async function readManifest(): Promise<Recording[]> {
  await ensureRecordingsDir();
  const info = await FileSystem.getInfoAsync(MANIFEST_FILE);
  if (!info.exists) {
    return [];
  }
  try {
    const raw = await FileSystem.readAsStringAsync(MANIFEST_FILE);
    if (!raw.trim()) return [];
    return JSON.parse(raw) as Recording[];
  } catch (err) {
    // Corrupt manifest should not crash the app — start fresh.
    console.warn("[localStore] manifest parse error, starting fresh:", err);
    return [];
  }
}

/** Persist the entire manifest atomically. */
async function writeManifest(recordings: Recording[]): Promise<void> {
  await ensureRecordingsDir();
  await FileSystem.writeAsStringAsync(
    MANIFEST_FILE,
    JSON.stringify(recordings, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all recordings, most recent first. */
export async function listRecordings(): Promise<Recording[]> {
  const rows = await readManifest();
  return rows.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Get a single recording by id, or null. */
export async function getRecording(id: string): Promise<Recording | null> {
  const rows = await readManifest();
  return rows.find((r) => r.id === id) ?? null;
}

/** Insert a new recording or replace an existing one (by id). */
export async function upsertRecording(recording: Recording): Promise<void> {
  const rows = await readManifest();
  const idx = rows.findIndex((r) => r.id === recording.id);
  if (idx >= 0) {
    rows[idx] = recording;
  } else {
    rows.push(recording);
  }
  await writeManifest(rows);
}

/** Update the status of a recording. */
export async function setStatus(
  id: string,
  status: SyncStatus
): Promise<void> {
  const rows = await readManifest();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx >= 0) {
  rows[idx].status = status;
    rows[idx].updatedAt = new Date().toISOString();
    await writeManifest(rows);
  }
}

/**
 * Remove a recording from the manifest AND delete its local audio file.
 */
export async function removeRecording(id: string): Promise<void> {
  const rows = await readManifest();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return;

  const recording = rows[idx];

  // Delete the local audio file if it exists
  if (recording.localUri) {
    try {
      const fileinfo = await FileSystem.getInfoAsync(recording.localUri);
      if (fileinfo.exists) {
        await FileSystem.deleteAsync(recording.localUri, {
          idempotent: true,
        });
      }
    } catch (err) {
      console.warn("[localStore] failed to delete audio file:", err);
    }
  }

  rows.splice(idx, 1);
  await writeManifest(rows);
}

/** Count recordings. */
export async function countRecordings(): Promise<number> {
  const rows = await readManifest();
  return rows.length;
}

/**
 * Reset any recording stuck in `uploading` back to `local` on app relaunch.
 *
 * Per the sync-flow ADR: a row claiming `uploading` across a cold start
 * means the previous upload was interrupted. Reseting it to `local` lets
 * the sync engine requeue it, so no recording is stuck in `uploading`.
 */
export async function resetStuckUploading(): Promise<number> {
  const rows = await readManifest();
  let changed = 0;
  for (const row of rows) {
    if (row.status === "uploading") {
      row.status = "local";
      row.updatedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed > 0) {
    await writeManifest(rows);
  }
  return changed;
}

/** Get all recordings in a given status (used by the sync engine). */
export async function findByStatus(status: SyncStatus): Promise<Recording[]> {
  const rows = await readManifest();
  return rows.filter((r) => r.status === status);
}