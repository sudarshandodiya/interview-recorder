import type {
  Recording,
  CreateRecordingPayload,
  ApiError,
  AudioUrlResponse,
  ListRecordingsResponse,
  GetRecordingResponse,
  CreateRecordingResponse,
  UploadAudioResponse,
  RetryUploadResponse,
  DeleteRecordingResponse,
} from "@interview-recorder/shared";

// ---------------------------------------------------------------------------
// Mobile API client (T-009)
//
// Typed fetch wrapper for the backend contract from the sync-flow ADR:
//   - createRecording  -> POST /api/recordings          (metadata-only, local)
//   - uploadAudio      -> POST /api/recordings/:id/audio (multipart file)
//   - retryUpload      -> POST /api/recordings/:id/retry (multipart file, failed)
//   - listRecordings   -> GET  /api/recordings
//   - getRecording     -> GET  /api/recordings/:id
//   - deleteRecording  -> DELETE /api/recordings/:id
//   - getAudioUrl      -> GET  /api/recordings/:id/audio (presigned url)
//
// Auth: per-interviewer stub via `x-user-id` header (see README Decisions +
// backend services/auth.ts).
// ---------------------------------------------------------------------------

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
export const USER_ID =
  process.env.EXPO_PUBLIC_USER_ID ??
  "00000000-0000-0000-0000-000000000001";

interface FetchError extends Error {
  status?: number;
  networkError?: boolean;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-user-id", USER_ID);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch (err) {
    const e: FetchError = new Error(
      `Network error: ${(err as Error).message}`
    );
    e.networkError = true;
    throw e;
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const apiErr = body as ApiError | undefined;
    const e: FetchError = new Error(
      apiErr?.message ?? `HTTP ${res.status}`
    );
    e.status = res.status;
    throw e;
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Multipart audio upload helper. React Native fetch supports FormData with a
// file URI via `expo-file-system`/Blob; we use the typed `file` field name to
// match the backend's `req.file()`.
// ---------------------------------------------------------------------------

async function uploadAudioFile(
  path: string,
  fileUri: string,
  mimeType: string,
  filename = "recording.m4a"
): Promise<Recording> {
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: filename,
    type: mimeType,
  // RN FormData typing is loose; cast through unknown to avoid TS noise.
  } as unknown as Blob);

  const headers = new Headers();
  headers.set("x-user-id", USER_ID);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    const e: FetchError = new Error(
      `Network error: ${(err as Error).message}`
    );
    e.networkError = true;
    throw e;
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const apiErr = body as ApiError | undefined;
    const e: FetchError = new Error(apiErr?.message ?? `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }

  return (body as UploadAudioResponse).data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Step 1 — create a metadata-only recording (status `local`). */
export async function createRecording(
  payload: CreateRecordingPayload
): Promise<Recording> {
  const res = await request<CreateRecordingResponse>("/api/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.data;
}

/** Step 2 — upload the audio file (transitions local -> synced/failed). */
export function uploadAudio(
  id: string,
  fileUri: string,
  mimeType: string,
  filename?: string
): Promise<Recording> {
  return uploadAudioFile(`/api/recordings/${id}/audio`, fileUri, mimeType, filename);
}

/** Manual re-upload of audio for a recording in `failed` status. */
export function retryUpload(
  id: string,
  fileUri: string,
  mimeType: string,
  filename?: string
): Promise<Recording> {
  return uploadAudioFile(`/api/recordings/${id}/retry`, fileUri, mimeType, filename);
}

/** List the requesting interviewer's recordings (most recent first). */
export async function listRecordings(): Promise<Recording[]> {
  const res = await request<ListRecordingsResponse>("/api/recordings");
  return res.data;
}

/** Fetch a single recording's details. */
export async function getRecording(id: string): Promise<Recording> {
  const res = await request<GetRecordingResponse>(`/api/recordings/${id}`);
  return res.data;
}

/** Delete a recording and its audio file (owner-only). */
export async function deleteRecording(
  id: string
): Promise<{ deleted: true; id: string }> {
  const res = await request<DeleteRecordingResponse>(`/api/recordings/${id}`, {
    method: "DELETE",
  });
  return res.data;
}

/** Fetch the presigned/serve URL and mime type for playback (owner-only). */
export async function getAudioUrl(
  id: string
): Promise<{ url: string; mimeType: string }> {
  const res = await request<AudioUrlResponse>(`/api/recordings/${id}/audio`);
  return res.data;
}

// Re-export for sync engine convenience.
export type { FetchError, UploadAudioResponse, RetryUploadResponse };