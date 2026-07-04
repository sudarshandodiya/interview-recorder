import type { Recording, SyncStatus } from "@interview-recorder/shared";
import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  classifyError,
} from "@interview-recorder/shared";
import * as localStore from "./localStore.js";
import * as api from "./api.js";

// ---------------------------------------------------------------------------
// Mobile sync engine (T-015) — the second reliability pillar.
//
// Owns the on-device state machine driving recording uploads:
//   local -> uploading -> synced   (success)
//   local -> uploading -> local     (transient retry, backoff 1s..16s, 5 tries)
//   local -> uploading -> failed    (terminal, non-transient error)
//   failed -> uploading -> synced   (manual retry)
//
// Design constraints (PRD §4 / §5 F5, sync-flow ADR):
//   - Resumable across cold starts: on app start, resetStuckUploading()
//     reverts any row claiming `uploading` back to `local` so nothing is
//     ever stuck.
//   - Exponential backoff: BACKOFF_MS = [1,2,4,8,16]s; MAX_ATTEMPTS = 5.
//   - classifyError(): network/5xx -> transient (retry); 4xx/auth ->
//     non-transient (terminal `failed`).
//   - Status is the on-device manifest's truth; the backend confirms `synced`
//     once the audio lands server-side and we update the local row.
// ---------------------------------------------------------------------------

/** Listener for status changes (used by UI to re-render list). */
type StatusListener = (id: string, status: SyncStatus) => void;

const listeners = new Set<StatusListener>();

/** Subscribe to recording status changes. Returns an unsubscribe fn. */
export function onStatusChange(cb: StatusListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(id: string, status: SyncStatus): void {
  for (const l of listeners) l(id, status);
}

/** A registry mapping recordingId → any in-flight retry timer, for teardown. */
const inflight = new Map<string, ReturnType<typeof setTimeout>>();

/** Cancel any pending retry/backoff timer for a recording. */
function cancelTimer(id: string): void {
  const t = inflight.get(id);
  if (t) {
    clearTimeout(t);
    inflight.delete(id);
  }
}

/** Attempt up to MAX_ATTEMPTS uploads of a recording with backoff. */
async function attemptUpload(id: string, fromStatus: SyncStatus): Promise<void> {
  const rec = await localStore.getRecording(id);
  if (!rec || !rec.localUri) {
    notify(id, "failed");
    return;
  }

  retryLoop: for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Mark uploading.
      await localStore.setStatus(id, "uploading");
      notify(id, "uploading");

      let updated: Recording;
      if (fromStatus === "failed") {
        // Manual re-upload of a previously-failed recording: the server
        // row already exists, so skip the create step and just re-send the
        // audio via the /retry endpoint.
        updated = await api.retryUpload(id, rec.localUri, rec.mimeType);
      } else {
        // First-time upload from `local`. Two-step per the sync-flow ADR:
        //   1. POST /api/recordings          (idempotent metadata create)
        //   2. POST /api/recordings/:id/audio (multipart upload of the audio)
        // Both retry together under backoff; the create step is idempotent
        // on the client-supplied id so a retry that already created the row
        // uses it instead of failing on PK conflict.
        await api.createRecording({
          id: rec.id,
          title: rec.title,
          intervieweeName: rec.intervieweeName,
          role: rec.role,
          tags: rec.tags,
          notes: rec.notes,
          durationMs: rec.durationMs,
          fileSizeBytes: rec.fileSizeBytes,
          mimeType: rec.mimeType,
        });
        updated = await api.uploadAudio(id, rec.localUri, rec.mimeType);
      }

      // Reconcile server response into the local row.
      await localStore.upsertRecording({
        ...rec,
        status: updated.status === "synced" ? "synced" : updated.status,
        s3Key: updated.s3Key ?? rec.s3Key,
        updatedAt: updated.updatedAt ?? new Date().toISOString(),
      });
      notify(id, "synced");
      cancelTimer(id);
      return;
    } catch (err) {
      const cls = classifyError({
        status: (err as { status?: number }).status,
        networkError: (err as { networkError?: boolean }).networkError,
        message: (err as Error).message,
      });

      if (cls === "non-transient") {
        // 4xx / auth / not-found: terminal failure.
        await localStore.setStatus(id, "failed");
        notify(id, "failed");
        cancelTimer(id);
        return;
      }

      // Transient: retry with backoff, unless this was the last attempt.
      if (attempt === MAX_ATTEMPTS) {
        await localStore.setStatus(id, "failed");
        notify(id, "failed");
        cancelTimer(id);
        return;
      }

      // Revert to `local` (or leave as the originating `failed` status) and
      // schedule the next attempt after backoff.
      await localStore.setStatus(id, fromStatus === "failed" ? "local" : "local");
      notify(id, "local");

      const delay = BACKOFF_MS[attempt - 1] ?? 16000;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        inflight.set(id, t);
      });
      // loop continues to retryLoop
      continue retryLoop;
    }
  }
}

/**
 * Queue a recording for upload. Idempotent: if it's already uploading or
 * synced, this is a no-op.
 */
export async function enqueueUpload(id: string): Promise<void> {
  const rec = await localStore.getRecording(id);
  if (!rec) return;
  if (rec.status === "uploading" || rec.status === "synced") return;

  // Fire and forget; backoff/idempotency handled inside.
  void attemptUpload(id, rec.status === "failed" ? "failed" : "local");
}

/**
 * Manual re-upload for a recording in `failed` status. Used by the list view's
 * "retry" action (T-014).
 */
export async function manualRetry(id: string): Promise<void> {
  cancelTimer(id);
  await localStore.setStatus(id, "uploading");
  notify(id, "uploading");
  void attemptUpload(id, "failed");
}

/**
 * Upload any recordings in `local` status. Called on app launch and on
 * network-restoration signals. Safe to call repeatedly.
 */
export async function syncPending(): Promise<void> {
  // Reset any stuck uploading -> local first.
  await localStore.resetStuckUploading();
  const pending = await localStore.findByStatus("local");
  for (const rec of pending) {
    void attemptUpload(rec.id, "local");
  }
}

/** Initialize the sync engine on app launch. */
export async function initSyncEngine(): Promise<void> {
  await localStore.resetStuckUploading();
  await syncPending();
}

/** Tear down: cancel all pending timers (e.g., on app backgrounding). */
export function stopSyncEngine(): void {
  for (const [, t] of inflight) clearTimeout(t);
  inflight.clear();
}