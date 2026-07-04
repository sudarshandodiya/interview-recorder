# API Documentation

## Base URL

```
http://localhost:3000
```

## Authentication

Stub auth seam (per PRD §7 "Known Limitation"). Every `/api/*` endpoint
requires an `x-user-id` header identifying the interviewer. Two dev users
are seeded on startup:

| User ID | Email |
|---------|-------|
| `00000000-0000-0000-0000-000000000001` | alice@example.com |
| `00000000-0000-0000-0000-000000000002` | bob@example.com |

Requests without the header (or with an unknown user) receive `401`.
The `/health` endpoint is exempt.

---

## Sync Model (Client-Driven)

The mobile client owns the sync state machine. Upload is a **two-step**
process (see README sync-flow ADR):

1. **Create** the recording metadata (status `local`).
2. **Upload** the audio file (status → `synced` or `failed`).

State transitions: `local` → `uploading` → `synced` (success) / `failed`
(non-transient error). Transient failures (network / 5xx) revert to the
prior state for client-side retry with exponential backoff.

---

## Endpoints

### `GET /health`

Health check (no auth required).

**Response** `200 OK`
```json
{ "status": "ok" }
```

---

### `GET /api/recordings`

List all recordings owned by the authenticated user, newest first.

**Headers:** `x-user-id: <uuid>`

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "title": "Interview with Jane Doe",
      "intervieweeName": "Jane Doe",
      "role": "Senior Backend Engineer",
      "tags": ["engineering", "senior"],
      "notes": "Strong candidate",
      "durationMs": 1800000,
      "fileSizeBytes": 15728640,
      "mimeType": "audio/mp4",
      "status": "synced",
      "s3Key": "recordings/uuid/recording.m4a",
      "createdAt": "2026-07-03T12:00:00.000Z",
      "updatedAt": "2026-07-03T12:05:00.000Z"
    }
  ]
}
```

---

### `GET /api/recordings/:id`

Fetch a single recording by ID (owner-only; returns 404 for non-owned
recordings to avoid leaking existence).

**Headers:** `x-user-id: <uuid>`

**Response** `200 OK`
```json
{ "data": { ... } }
```

**Response** `404 Not Found`
```json
{ "error": "Not Found", "message": "Recording not found", "statusCode": 404 }
```

---

### `POST /api/recordings` — Step 1: Create metadata

Create a metadata-only recording with status `local`. No audio file is
sent in this step.

**Headers:** `x-user-id: <uuid>`, `Content-Type: application/json`

**Body:**
```json
{
  "intervieweeName": "Jane Doe",
  "role": "Senior Backend Engineer",
  "tags": ["system-design", "senior"],
  "notes": "Strong candidate",
  "durationMs": 1800000,
  "title": "Optional — defaults to \"Interview with <intervieweeName>\""
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intervieweeName` | string | **yes** | Interviewee name |
| `role` | string | no | Interviewee role/position |
| `tags` | string[] | no | Searchable tags |
| `notes` | string | no | Free-form session notes |
| `durationMs` | number | no | Duration in milliseconds (default 0) |
| `title` | string | no | Title (defaults to "Interview with \<name\>") |

**Response** `201 Created`
```json
{ "data": { "id": "uuid", "status": "local", "s3Key": null, ... } }
```

---

### `POST /api/recordings/:id/audio` — Step 2: Upload audio

Upload the audio file for a recording created in Step 1. Transitions the
recording from `local` → `uploading` → `synced` (or `failed`).

**Headers:** `x-user-id: <uuid>`, `Content-Type: multipart/form-data`

**Body:** `multipart/form-data` with a `file` field containing the audio.

**Response** `200 OK`
```json
{ "data": { "status": "synced", "s3Key": "recordings/.../rec.m4a", ... } }
```

| Status Code | Condition |
|-------------|-----------|
| 200 | Upload succeeded, recording is now `synced` |
| 400 | No file provided, or file is empty, or recording is `failed` (use `/retry`) |
| 404 | Recording not found or not owned by the user |
| 409 | Recording is already `synced` |
| 503 | Transient S3 failure; recording reverted to `local` — client should retry |

---

### `POST /api/recordings/:id/retry` — Re-upload a failed recording

Re-attempt the audio upload for a recording whose status is `failed`.

**Headers:** `x-user-id: <uuid>`, `Content-Type: multipart/form-data`

**Body:** `multipart/form-data` with a `file` field containing the audio.

**Response** `200 OK`
```json
{ "data": { "status": "synced", ... } }
```

| Status Code | Condition |
|-------------|-----------|
| 200 | Retry succeeded, recording is now `synced` |
| 400 | No file provided, or recording is not in `failed` status |
| 404 | Recording not found or not owned by the user |
| 503 | Transient failure; recording remains `failed` — client should retry |

---

### `GET /api/recordings/:id/audio` — Download / pre-signed URL

Get a short-lived pre-signed URL for downloading the audio file
(owner-only, only available for `synced` recordings).

**Headers:** `x-user-id: <uuid>`

**Response** `200 OK`
```json
{ "data": { "url": "https://s3.../recordings/.../rec.m4a?...", "mimeType": "audio/mp4" } }
```

| Status Code | Condition |
|-------------|-----------|
| 200 | Pre-signed URL generated |
| 404 | Recording not found or not owned by the user |
| 409 | Audio not yet available (recording not `synced`) |

---

### `DELETE /api/recordings/:id`

Delete a recording and its associated S3 audio file (owner-only).

**Headers:** `x-user-id: <uuid>`

**Response** `200 OK`
```json
{ "data": { "deleted": true, "id": "uuid" } }
```

**Response** `404 Not Found` — recording not found or not owned by the user.

---

## Data Models

### `Recording`

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `userId` | UUID | Owner (authenticated interviewer) |
| `title` | string | Human-readable title (defaults to "Interview with \<name\>") |
| `intervieweeName` | string | Name of interviewee (required) |
| `role` | string? | Interviewee role/position |
| `tags` | string[] | Searchable tags |
| `notes` | string? | Free-form session notes |
| `durationMs` | integer | Recording duration in milliseconds |
| `fileSizeBytes` | integer | File size in bytes |
| `mimeType` | string | MIME type (e.g. `audio/mp4`) |
| `status` | enum | `local` \| `uploading` \| `synced` \| `failed` |
| `s3Key` | string? | S3 object key (set once audio is uploaded) |
| `createdAt` | ISO 8601 | Created timestamp |
| `updatedAt` | ISO 8601 | Last updated timestamp |