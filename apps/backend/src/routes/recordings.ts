import { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { uploadToS3, ensureBucket } from "../services/storage.js";
import { syncRecordingToS3 } from "../services/sync.js";
import { randomUUID } from "node:crypto";

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  // Ensure the S3 bucket exists on first request (LocalStack compat)
  await ensureBucket();

  // ---- List all recordings ----
  app.get("/api/recordings", async (_req, reply) => {
    const rows = await db
      .select()
      .from(recordings)
      .orderBy(desc(recordings.createdAt));

    return reply.send({ data: rows });
  });

  // ---- Get a single recording ----
  app.get<{ Params: { id: string } }>(
    "/api/recordings/:id",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(recordings)
        .where(eq(recordings.id, req.params.id))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Recording not found",
          statusCode: 404,
        });
      }

      return reply.send({ data: rows[0] });
    }
  );

  // ---- Upload a recording ----
  app.post("/api/recordings", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Audio file is required",
        statusCode: 400,
      });
    }

    const fields = file.fields as Record<string, { value: string }>;
    const title = fields.title?.value ?? "Untitled";
    const intervieweeName = fields.intervieweeName?.value ?? "Unknown";
    const tags = fields.tags?.value
      ? fields.tags.value.split(",").map((t) => t.trim())
      : [];
    const notes = fields.notes?.value;
    const durationMs = parseInt(fields.durationMs?.value ?? "0", 10);

    const buffer = await file.toBuffer();
    const recordingId = randomUUID();
    const s3Key = `recordings/${recordingId}/${file.filename}`;

    // Insert DB record
    const [recording] = await db
      .insert(recordings)
      .values({
        id: recordingId,
        userId: "00000000-0000-0000-0000-000000000001", // placeholder
        title,
        intervieweeName,
        tags,
        notes,
        durationMs,
        fileSizeBytes: buffer.length,
        mimeType: file.mimetype,
        s3Key,
        status: "local",
      })
      .returning();

    // Upload in background (fire-and-forget for now)
    syncRecordingToS3(recordingId, async () => {
      await uploadToS3(s3Key, buffer, file.mimetype);
    }).catch(console.error);

    return reply.status(201).send({ data: recording });
  });

  // ---- Delete a recording ----
  app.delete<{ Params: { id: string } }>(
    "/api/recordings/:id",
    async (req, reply) => {
      const rows = await db
        .delete(recordings)
        .where(eq(recordings.id, req.params.id))
        .returning();

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Recording not found",
          statusCode: 404,
        });
      }

      return reply.send({ data: { deleted: true, id: rows[0].id } });
    }
  );

  // ---- Re-upload a failed recording ----
  app.post<{ Params: { id: string } }>(
    "/api/recordings/:id/retry",
    async (req, reply) => {
      const rows = await db
        .select()
        .from(recordings)
        .where(eq(recordings.id, req.params.id))
        .limit(1);

      if (rows.length === 0) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Recording not found",
          statusCode: 404,
        });
      }

      const recording = rows[0];
      if (recording.status !== "failed") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Only failed recordings can be retried",
          statusCode: 400,
        });
      }

      // Re-attempt upload
      syncRecordingToS3(recording.id, async () => {
        // In practice, the file would need to be re-read from local storage
        // For now, this is a placeholder
      }).catch(console.error);

      return reply.send({ data: { retrying: true, id: recording.id } });
    }
  );
}
