import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Retry-eligible upload helper.
 *
 * In production this would run inside a job queue with exponential backoff.
 * For now, it's a simple retry loop that the route layer can call.
 */
export async function syncRecordingToS3(
  recordingId: string,
  uploadFn: (id: string) => Promise<void>,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Mark as uploading
      await db
        .update(recordings)
        .set({ status: "uploading" })
        .where(eq(recordings.id, recordingId));

      await uploadFn(recordingId);

      // Mark as synced
      await db
        .update(recordings)
        .set({ status: "synced" })
        .where(eq(recordings.id, recordingId));

      return;
    } catch (err) {
      if (attempt === maxRetries) {
        await db
          .update(recordings)
          .set({ status: "failed" })
          .where(eq(recordings.id, recordingId));
        throw err;
      }
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}
