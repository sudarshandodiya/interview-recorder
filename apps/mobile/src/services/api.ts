import type {
  ApiError,
  AudioUrlResponse,
  CreateRecordingPayload,
  CreateRecordingResponse,
  DeleteRecordingResponse,
  GetRecordingResponse,
  ListRecordingsResponse,
  Recording,
  RetryUploadResponse,
  UploadAudioResponse,
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
// Auth: Tinyauth (OIDC). The id token is held by `tokenStore` and attached as
// `Authorization: Bearer <token>` to every request. A 401 invokes the
// registered `onAuthExpired` callback so the AuthProvider can drop the token
// and show the login screen. See src/auth/AuthContext.ts.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// --- Bearer token holder (set by AuthProvider; read by every request) -------
let authToken: string | null = null;
let onAuthExpired: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setOnAuthExpired(cb: (() => void) | null): void {
  onAuthExpired = cb;
}

interface FetchError extends Error {
  status?: number;
  networkError?: boolean;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  return headers;
}

function handleStatus(status: number): void {
  if (status === 401 && onAuthExpired) {
    // Token missing/invalid/expired — surface to the AuthProvider so it clears
    // secure storage and shows the login screen again.
    onAuthExpired();
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch (err) {
    const e: FetchError = new Error(`Network error: ${(err as Error).message}`);
    e.networkError = true;
    throw e;
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    handleStatus(res.status);
    const apiErr = body as ApiError | undefined;
    const e: FetchError = new Error(apiErr?.message ?? `HTTP ${res.status}`);
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
  filename = "recording.m4a",
): Promise<Recording> {
  const form = new FormData();
  form.append("file", {
    uri: fileUri,
    name: filename,
    type: mimeType,
    // RN FormData typing is loose; cast through unknown to avoid TS noise.
  } as unknown as Blob);

  const headers = new Headers();
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    const e: FetchError = new Error(`Network error: ${(err as Error).message}`);
    e.networkError = true;
    throw e;
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    handleStatus(res.status);
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
  payload: CreateRecordingPayload,
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
  filename?: string,
): Promise<Recording> {
  return uploadAudioFile(
    `/api/recordings/${id}/audio`,
    fileUri,
    mimeType,
    filename,
  );
}

/** Manual re-upload of audio for a recording in `failed` status. */
export function retryUpload(
  id: string,
  fileUri: string,
  mimeType: string,
  filename?: string,
): Promise<Recording> {
  return uploadAudioFile(
    `/api/recordings/${id}/retry`,
    fileUri,
    mimeType,
    filename,
  );
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
  id: string,
): Promise<{ deleted: true; id: string }> {
  const res = await request<DeleteRecordingResponse>(`/api/recordings/${id}`, {
    method: "DELETE",
  });
  return res.data;
}

/** Fetch the presigned/serve URL and mime type for playback (owner-only). */
export async function getAudioUrl(
  id: string,
): Promise<{ url: string; mimeType: string }> {
  const res = await request<AudioUrlResponse>(`/api/recordings/${id}/audio`);
  return res.data;
}

// Re-export for sync engine convenience.
export type { FetchError, RetryUploadResponse, UploadAudioResponse };
