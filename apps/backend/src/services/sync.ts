import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { uploadToS3 } from "./storage.js";

// ---------------------------------------------------------------------------
// Two-step client-driven sync (per the sync-flow ADR in README.md).
// ---------------------------------------------------------------------------
// The backend owns the `local -> uploading -> synced/failed` transition
// during the audio upload step. The mobile client owns the retry schedule
// (exponential backoff 1s -> 2s -> 4s -> 8s -> 16s, 5 attempts per PRD §4)
// and re-calls the audio / retry endpoint.
//
// Transient S3 failures (network / 5xx) reset the recording to its prior
// state and surface as HTTP 503 so the client classifies them as transient.
// Non-transient failures (bad request / wrong status) are handled in the
// route layer before this helper runs.

export type UploadOutcome = "synced" | "transient-failure";

/**
 * Upload the audio file for a recording, transitioning its status.
 *
 * Pre: the recording exists and belongs to the caller (route layer verifies).
 * On success: status -> `synced`, s3Key/fileSize/mimeType set.
 * On transient S3 failure: status reset to `revertTo`, throws.
 *
 * @param recordingId  Recording to upload audio for.
 * @param userId       Owner (used in the S3 key namespace).
 * @param buffer       Audio bytes.
 * @param mimeType     MIME type, e.g. `audio/mp4`.
 * @param filename     Original filename (used in S3 key).
 * @param revertTo     Status to revert to on transient failure (`local` for
 *                     first upload, `failed` for retry).
 */
export async function uploadAudioRecording(
  recordingId: string,
  userId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  revertTo: "local" | "failed"
): Promise<void> {
  const s3Key = `recordings/${userId}/${recordingId}/${filename}`;

  // Mark uploading.
  await db
    .update(recordings)
    .set({ status: "uploading" })
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)));

  try {
    await uploadToS3(s3Key, buffer, mimeType);
    await db
      .update(recordings)
      .set({
        status: "synced",
        s3Key,
        fileSizeBytes: buffer.length,
        mimeType,
      })
      .where(
        and(eq(recordings.id, recordingId), eq(recordings.userId, userId))
      );
  } catch (err) {
    // Transient: revert so the client can retry from a known state.
    await db
      .update(recordings)
      .set({ status: revertTo })
      .where(
        and(eq(recordings.id, recordingId), eq(recordings.userId, userId))
      );
    throw err;
  }
}