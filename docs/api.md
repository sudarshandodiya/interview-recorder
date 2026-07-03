# API Documentation

## Base URL

```
http://localhost:3000/api
```

## Authentication

*Placeholder* — JWT-based authentication will be added. Currently, all requests
are unauthenticated and hard-coded to a test user.

---

## Endpoints

### `GET /health`

Health check.

**Response** `200 OK`
```json
{ "status": "ok" }
```

---

### `GET /api/recordings`

List all recordings for the current user, ordered by most recent first.

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "title": "Interview with Jane Doe",
      "intervieweeName": "Jane Doe",
      "tags": ["engineering", "senior"],
      "notes": "Strong candidate",
      "durationMs": 1800000,
      "fileSizeBytes": 15728640,
      "mimeType": "audio/mp4",
      "status": "synced",
      "s3Key": "recordings/uuid/recording.mp4",
      "createdAt": "2026-07-03T12:00:00.000Z",
      "updatedAt": "2026-07-03T12:05:00.000Z"
    }
  ]
}
```

---

### `GET /api/recordings/:id`

Fetch a single recording by ID.

**Response** `200 OK`
```json
{ "data": { ... } }
```

**Response** `404 Not Found`
```json
{ "error": "Not Found", "message": "Recording not found", "statusCode": 404 }
```

---

### `POST /api/recordings`

Upload a new recording. Send as `multipart/form-data`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | yes | Audio file to upload |
| `title` | string | no | Title (defaults to "Untitled") |
| `intervieweeName` | string | no | Interviewee name (defaults to "Unknown") |
| `tags` | string | no | Comma-separated tags |
| `notes` | string | no | Session notes |
| `durationMs` | integer | no | Duration in milliseconds |

**Response** `201 Created`
```json
{ "data": { ... } }
```

---

### `DELETE /api/recordings/:id`

Delete a recording and its associated file.

**Response** `200 OK`
```json
{ "data": { "deleted": true, "id": "uuid" } }
```

---

### `POST /api/recordings/:id/retry`

Re-attempt upload for a recording whose status is `"failed"`.

**Response** `200 OK`
```json
{ "data": { "retrying": true, "id": "uuid" } }
```

**Response** `400 Bad Request` — if the recording is not in `"failed"` state.

---

## Data Models

### `Recording`

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `userId` | UUID | Owner (placeholder) |
| `title` | string | Human-readable title |
| `intervieweeName` | string | Name of interviewee |
| `tags` | string[] | Searchable tags |
| `notes` | string? | Free-form session notes |
| `durationMs` | integer | Recording duration |
| `fileSizeBytes` | integer | File size |
| `mimeType` | string | MIME type (e.g. `audio/mp4`) |
| `status` | enum | `local` \| `uploading` \| `synced` \| `failed` |
| `s3Key` | string? | S3 object key |
| `createdAt` | ISO 8601 | Created timestamp |
| `updatedAt` | ISO 8601 | Last updated timestamp |
