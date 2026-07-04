import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { recordings } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import {
  ensureBucket,
  getDownloadUrl,
  deleteFromS3,
} from "../services/storage.js";
import { uploadAudioRecording } from "../services/sync.js";
import { authHook } from "../services/auth.js";

// ---------------------------------------------------------------------------
// Recording routes — per-user scoped (PRD §6 "Per-user privacy", §7 auth seam).
// Two-step client-driven upload contract (see README sync-flow ADR):
//   1. POST /api/recordings            metadata-only create, status `local`
//   2. POST /api/recordings/:id/audio  multipart upload -> `synced`/`failed`
//   3. POST /api/recordings/:id/retry  re-upload audio for `failed` only
// ---------------------------------------------------------------------------

const NOT_FOUND = {
  error: "Not Found",
  message: "Recording not found",
  statusCode: 404,
};

/** Select a recording owned by the user, or null (leaks no existence info). */
async function getOwned(id: string, userId: string) {
  const rows = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  // Ensure the S3 bucket exists (LocalStack compat).
  await ensureBucket();

  // Per-user auth seam on every recording route.
  app.addHook("preHandler", authHook);

  // ---- List the requesting user's recordings (newest first) ----
  app.get("/api/recordings", async (req: FastifyRequest, reply: FastifyReply) => {
    const rows = await db
      .select()
      .from(recordings)
      .where(eq(recordings.userId, req.user.id))
      .orderBy(desc(recordings.createdAt));
    return reply.send({ data: rows });
  });

  // ---- Fetch a single recording (owner-only) ----
  app.get<{ Params: { id: string } }>(
    "/api/recordings/:id",
    async (req, reply) => {
      const rec = await getOwned(req.params.id, req.user.id);
      if (!rec) return reply.status(404).send(NOT_FOUND);
      return reply.send({ data: rec });
    }
  );

  // ---- Step 1: create a metadata-only recording (status `local`) ----
  app.post("/api/recordings", async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;

    const intervieweeName = String(body?.intervieweeName ?? "").trim();
    if (!intervieweeName) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "intervieweeName is required",
        statusCode: 400,
      });
    }

    const durationMs = Number(body?.durationMs ?? 0);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "durationMs must be a non-negative number",
        statusCode: 400,
      });
    }

    const title =
      String(body?.title ?? "").trim() || `Interview with ${intervieweeName}`;
    const role = body?.role ? String(body.role) : null;
    const notes = body?.notes ? String(body.notes) : null;
    const tags = Array.isArray(body?.tags)
      ? (body.tags as unknown[]).map(String)
      : [];
    const fileSizeBytes = body?.fileSizeBytes
      ? Number(body.fileSizeBytes)
      : 0;
    const mimeType = body?.mimeType ? String(body.mimeType) : "audio/mp4";

    // Optional client-supplied id: lets the offline-first mobile client pass
    // its locally-generated recording id so the same id is used in the audio
    // upload path (`POST /api/recordings/:id/audio`) without id remapping.
    // When omitted, the schema's `defaultRandom()` generates one.
    const clientId = body?.id ? String(body.id) : undefined;
    // Idempotent create: a client retry with the same id returns the
    // existing row instead of failing on PK conflict.
    const rec = clientId
      ? (
          await db
            .insert(recordings)
            .values({
              id: clientId,
              userId: req.user.id,
              title,
              intervieweeName,
              role,
              tags,
              notes,
              durationMs,
              fileSizeBytes,
              mimeType,
              status: "local",
            })
            .onConflictDoNothing({ target: recordings.id })
            .returning()
        )[0] ?? (await getOwned(clientId, req.user.id))
      : (
          await db
            .insert(recordings)
            .values({
              userId: req.user.id,
              title,
              intervieweeName,
              role,
              tags,
              notes,
              durationMs,
              fileSizeBytes,
              mimeType,
              status: "local",
            })
            .returning()
        )[0];

    return reply.status(201).send({ data: rec });
  });

  // ---- Step 2: upload the audio file (local -> uploading -> synced) ----
  app.post<{ Params: { id: string } }>(
    "/api/recordings/:id/audio",
    async (req, reply) => {
      const rec = await getOwned(req.params.id, req.user.id);
      if (!rec) return reply.status(404).send(NOT_FOUND);

      // Accept `local` (first upload) or `uploading` (recover a stuck attempt).
      // `synced` is already done; `failed` must use the retry endpoint.
      if (rec.status === "synced") {
        return reply.status(409).send({
          error: "Conflict",
          message: "Recording is already synced",
          statusCode: 409,
        });
      }
      if (rec.status === "failed") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Use /retry to re-upload a failed recording",
          statusCode: 400,
        });
      }

      const file = await req.file();
      if (!file) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Audio file (multipart 'file' field) is required",
          statusCode: 400,
        });
      }
      const buffer = await file.toBuffer();
      if (buffer.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Audio file is empty",
          statusCode: 400,
        });
      }

      try {
        await uploadAudioRecording(
          rec.id,
          req.user.id,
          buffer,
          file.mimetype,
          file.filename ?? "recording.m4a",
          "local"
        );
      } catch {
        // Transient S3 failure -> reverted to `local`; client retries.
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "Audio upload failed transiently; please retry",
          statusCode: 503,
        });
      }

      const updated = await getOwned(rec.id, req.user.id);
      return reply.send({ data: updated });
    }
  );

  // ---- Retry: re-upload audio for a `failed` recording ----
  app.post<{ Params: { id: string } }>(
    "/api/recordings/:id/retry",
    async (req, reply) => {
      const rec = await getOwned(req.params.id, req.user.id);
      if (!rec) return reply.status(404).send(NOT_FOUND);

      if (rec.status !== "failed") {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Only failed recordings can be retried",
          statusCode: 400,
        });
      }

      const file = await req.file();
      if (!file) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Audio file (multipart 'file' field) is required",
          statusCode: 400,
        });
      }
      const buffer = await file.toBuffer();
      if (buffer.length === 0) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Audio file is empty",
          statusCode: 400,
        });
      }

      try {
        await uploadAudioRecording(
          rec.id,
          req.user.id,
          buffer,
          file.mimetype,
          file.filename ?? "recording.m4a",
          "failed"
        );
      } catch {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "Retry failed transiently; please try again",
          statusCode: 503,
        });
      }

      const updated = await getOwned(rec.id, req.user.id);
      return reply.send({ data: updated });
    }
  );

  // ---- Download / pre-signed audio URL (owner-only) ----
  app.get<{ Params: { id: string } }>(
    "/api/recordings/:id/audio",
    async (req, reply) => {
      const rec = await getOwned(req.params.id, req.user.id);
      if (!rec) return reply.status(404).send(NOT_FOUND);
      if (!rec.s3Key || rec.status !== "synced") {
        return reply.status(409).send({
          error: "Conflict",
          message: "Audio is not yet available for this recording",
          statusCode: 409,
        });
      }
      const url = await getDownloadUrl(rec.s3Key);
      return reply.send({ data: { url, mimeType: rec.mimeType } });
    }
  );

  // ---- Delete a recording + its audio (owner-only) ----
  app.delete<{ Params: { id: string } }>(
    "/api/recordings/:id",
    async (req, reply) => {
      const rec = await getOwned(req.params.id, req.user.id);
      if (!rec) return reply.status(404).send(NOT_FOUND);

      if (rec.s3Key) await deleteFromS3(rec.s3Key);
      await db
        .delete(recordings)
        .where(
          and(eq(recordings.id, req.params.id), eq(recordings.userId, req.user.id))
        );

      return reply.send({ data: { deleted: true, id: rec.id } });
    }
  );
}