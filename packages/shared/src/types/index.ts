// ---- Core domain types shared between mobile app and backend ----

/**
 * Possible sync statuses for a recording.
 *
 * State machine (client-driven, per sync-flow ADR):
 *   local -> uploading -> synced             (success)
 *   local -> uploading -> local              (transient retry, up to 5 attempts)
 *   local -> uploading -> failed             (terminal, non-transient error)
 *   failed -> uploading -> synced            (manual re-upload)
 *
 * On app relaunch, any record claiming `uploading` is reset to `local`
 * so no recording is ever stuck in `uploading`.
 */
export type SyncStatus = "local" | "uploading" | "synced" | "failed";

/** Legal sync-state transitions (used as a guard, not an exhaustive API). */
export const SYNC_TRANSITIONS: Record<SyncStatus, SyncStatus[]> = {
  local: ["uploading"],
  uploading: ["synced", "failed", "local"],
  synced: [],
  failed: ["uploading"],
};

/** Metadata captured for a recording session (PRD F3). */
export interface RecordingMetadata {
  /** Interviewee (candidate) name. Required. */
  intervieweeName: string;
  /** Role / position being interviewed for. Optional. */
  role?: string;
  /** Freeform tags. Optional. */
  tags?: string[];
  /** Free-form session notes. Optional. */
  notes?: string;
}

/** Title is derived client-side from the interviewee name when not set. */
export interface Recording extends RecordingMetadata {
  id: string;
  userId: string;
  title: string;
  durationMs: number;
  fileSizeBytes: number;
  mimeType: string;
  status: SyncStatus;
  /** S3 object key, set once audio is uploaded server-side. */
  s3Key: string | null;
  /** Local file URI on device (mobile-only field; never serialized by backend). */
  localUri?: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/** Minimal user identity used by the stub auth seam. */
export interface AuthUser {
  id: string;
  email: string;
}

// ---------------------------------------------------------------------------
// API request / response envelopes (two-step client-driven upload contract)
// ---------------------------------------------------------------------------

/** Wrapper for successful responses. */
export interface ApiResponse<T> {
  data: T;
}

/** Standard error envelope. */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/** Step 1 — create a recording record with metadata only (status `local`). */
export interface CreateRecordingPayload {
  /**
   * Optional client-supplied id. Lets the offline-first mobile client pass
   * its locally-generated recording id so the same id is used in the audio
   * upload path (`POST /api/recordings/:id/audio`) without id remapping.
   * When omitted, the backend generates one via `defaultRandom()`.
   */
  id?: string;
  title: string;
  intervieweeName: string;
  role?: string;
  tags?: string[];
  notes?: string;
  durationMs: number;
  /** Optional: sent now if known, else filled at audio upload. */
  fileSizeBytes?: number;
  mimeType?: string;
}

/** Result of step 1: a recording with status `local` and no audio yet. */
export type CreateRecordingResponse = ApiResponse<Recording>;

/** Step 2 — upload the audio file for an existing metadata-only recording. */
export type UploadAudioResponse = ApiResponse<Recording>;

/** Manual re-upload of audio for a recording in `failed` status. */
export type RetryUploadResponse = ApiResponse<{ retrying: true; id: string }>;

/** List the requesting interviewer's recordings (most recent first). */
export type ListRecordingsResponse = ApiResponse<Recording[]>;

/** Fetch a single recording's details. */
export type GetRecordingResponse = ApiResponse<Recording>;

/** Delete a recording and its associated audio file. */
export type DeleteRecordingResponse = ApiResponse<{
  deleted: true;
  id: string;
}>;

/** Where to fetch the audio stream for a recording (per-user scoped). */
export type AudioUrlResponse = ApiResponse<{ url: string; mimeType: string }>;

// ---------------------------------------------------------------------------
// Sync engine classification (mobile-side)
// ---------------------------------------------------------------------------

/** Classification of an upload error for retry decisions. */
export type ErrorClass = "transient" | "non-transient";

/**
 * Transient: network down, timeout, HTTP 5xx, or anything indeterminate
 *   → retry with exponential backoff.
 * Non-transient: HTTP 4xx (bad request, auth, not found / ownership)
 *   → terminal `failed`; user must fix the underlying cause then retry.
 */
export function classifyError(err: {
  status?: number;
  message?: string;
  networkError?: boolean;
}): ErrorClass {
  if (err.networkError) return "transient";
  if (err.status === undefined) return "transient"; // unknown → assume transient
  if (err.status >= 500) return "transient";
  if (err.status >= 400 && err.status < 500) return "non-transient";
  return "transient";
}

/** Exponential backoff schedule for PRD §4: 1s → 2s → 4s → 8s → 16s. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
/** Maximum upload attempts before terminal `failed`. */
export const MAX_ATTEMPTS = 5;
