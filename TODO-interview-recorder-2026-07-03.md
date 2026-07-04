# TODO: Interview Recorder

> **Source spec:** `PRD-interview-recorder-2026-07-03.md`
> **Date:** 2026-07-03
> **Total tasks:** 21
> **Parallel groups:** 8

**Existing scaffold summary (already in repo):** Turborepo + pnpm +
mise, docker-compose (Postgres + LocalStack), backend Fastify app with
env/db/schema(S3)/sync-with-retry/5 routes, `docs/api.md`, Expo mobile
shell (`app/index.tsx`, `_layout.tsx`), shared types package. Phase 0
tasks below **verify and close gaps** in this scaffold rather than
re-create it.

## Dependency Tree

```
Phase 0 — Foundation & decisions
├── T-001  Verify infra bootstrap (mise/docker/db:up/migrate)     │ group: 0
├── T-003  Add role column + status CHECK to schema + migration   │ group: 0
│           blocks: T-005, T-002
├── T-004  Sync-flow ADR (client-driven vs server-driven)         │ group: 0
│           blocks: T-002, T-006
└── T-021  Resolve open questions (auth stub, audio fmt, a11y)    │ group: 0
            blocks: T-005, T-010

Phase 1 — Shared contracts + Recording core  [depends on Phase 0]
├── Track A: Shared Types
│   └── T-002  Extend shared types (role, state machine, envelopes)    │ group: 1
│              blocked-by: T-003, T-004   blocks: T-005,T-006,T-009
└── Track B: Mobile Recording
    └── T-010  Mobile recording service (expo-av)                 │ group: 1
               blocked-by: T-001, T-021   blocks: T-011,T-012,T-013,T-017

Phase 2 — Backend hardening + Mobile capture UI/sync  [depends on Phase 1]
├── Track C: Backend API
│   ├── T-005  Auth seam + per-user scoping                        │ group: 2
│   │          blocked-by: T-002, T-003   blocks: T-006,T-007,T-008
│   ├── T-006  Align upload/retry flow to ADR (audio upload state) │ group: 3
│   │          blocked-by: T-004, T-005   blocks: T-014,T-015,T-008
│   └── T-007  Backend audio download/serve endpoint               │ group: 3
│              blocked-by: T-005   blocks: T-018,T-008
├── Track D: Mobile Capture UI + Durability
│   ├── T-011  Live waveform + elapsed timer UI                    │ group: 2
│   │          blocked-by: T-010
│   └── T-012  Capture durability (flush + crash recovery)         │ group: 2
│              blocked-by: T-010   blocks: T-013
└── Track E: Mobile API/Data
    └── T-009  Mobile API client service                           │ group: 2
               blocked-by: T-002   blocks: T-014,T-015

Phase 3 — Mobile persistence, sync engine, views  [depends on Phase 2]
├── T-013  Mobile local storage repository                         │ group: 3
│          blocked-by: T-010, T-012   blocks: T-014,T-015,T-016,T-017
├── T-017  Mobile metadata capture form                            │ group: 4
│          blocked-by: T-013, T-010
├── T-015  Mobile sync engine (state machine + backoff)            │ group: 4
│          blocked-by: T-009, T-013, T-006   blocks: T-019
├── T-014  Mobile recordings list view (delete, retry)             │ group: 4
│          blocked-by: T-013, T-009, T-006
├── T-016  Mobile detail view shell                                 │ group: 5
│          blocked-by: T-014, T-013   blocks: T-018
└── T-008  Backend unit tests (scoping, state transitions)          │ group: 4
           blocked-by: T-006, T-007

Phase 4 — Playback, reliability, deliverables  [depends on Phase 3]
├── T-018  Mobile in-app playback                                  │ group: 6
│          blocked-by: T-016, T-007   blocks: T-020
├── T-019  Reliability integration test (crash/offline)            │ group: 5
│          blocked-by: T-015, T-012   blocks: T-020
└── T-020  Deliverables (README, api.md, test wiring)              │ group: 7
           blocked-by: T-008, T-017, T-018, T-019
```

## Parallel Work Groups

| Group | Tasks | Can start when |
|-------|-------|----------------|
| 0 | T-001, T-003, T-004, T-021 | Immediately |
| 1 | T-002, T-010 | Group 0 done |
| 2 | T-009, T-011, T-012, T-005 | Group 1 done |
| 3 | T-006, T-007, T-013 | Group 2 done |
| 4 | T-014, T-015, T-017, T-008 | Group 3 done |
| 5 | T-016, T-019 | Group 4 done |
| 6 | T-018 | Group 5 done |
| 7 | T-020 | Group 6 done |

> **Horizontal parallelism:** Phase 2 splits cleanly into Backend (Track C:
> T-005→T-006/T-007) and Mobile capture (Tracks D/E: T-009, T-011, T-012).
> These can be worked by two agents simultaneously once Phase 1 ships typed
> contracts.

## Critical Path

The serially-blocking chain that defines the minimum calendar time:

```
T-004 → T-002 → T-005 → T-006 → T-015 → T-019 → T-020
  (ADR)   (types)  (auth)   (flow)   (sync)   (test)  (deliverables)
```

Per PRD prioritization: **F1/F2/F4/F5 first** (capture + sync trust pillars),
**F3/F6 follow** (metadata + playback). T-010→T-012→T-013 (capture + local
store) and T-015 (sync engine) are the reliability spine — they must not
slip; T-017 (metadata) and T-018 (playback) sit on a non-critical branch.

## Task Details

### T-001: Verify infra bootstrap

| Field | Value |
|-------|-------|
| **Epic** | Foundation |
| **Description** | Confirm the existing monorepo scaffold runs: `mise install`, `pnpm install`, `mise run db:up`, `mise run db:migrate`, `mise run dev:backend` boots, `/health` responds, LocalStack S3 reachable, Expo `dev:mobile` starts. Document any gaps. |
| **Blocked by** | — |
| **Blocks** | T-010 |
| **Parallel group** | 0 |
| **Estimated effort** | 0.5 session |
| **Acceptance criteria** | `mise run dev:backend` boots; `curl /health` → `{"status":"ok"}`; Drizzle `push` creates `users` and `recordings` tables; `mise run dev:mobile` shows the Expo QR. |
| **Inputs** | Existing scaffold (`mise.toml`, `docker-compose.yml`, `apps/backend`, `apps/mobile`). |
| **Outputs** | Working dev environment; list of infra fixes (if any) filed as notes. |

### T-002: Extend shared types to PRD shape

| Field | Value |
|-------|-------|
| **Epic** | Shared contracts |
| **Description** | Update `packages/shared/src/types/index.ts` to match the final schema and PRD: add `role`/`position` to metadata, add explicit sync-state-machine transition type, add API request/response envelopes (list, detail, create/upload multipart, delete, re-upload), add `RecordingStatus` discriminated union, and the auth-user type used by both sides. Ensure backend and mobile import from this package (no duplicate local copies). |
| **Blocked by** | T-003, T-004 |
| **Blocks** | T-005, T-006, T-009 |
| **Parallel group** | 1 |
| **Estimated effort** | 0.5–1 session |
| **Acceptance criteria** | `pnpm --filter @interview-recorder/shared lint` passes; types compile in both `apps/backend` and `apps/mobile` when imported; no `any` in exported types; state machine type only permits legal transitions. |
| **Inputs** | Final schema (post T-003), sync-flow ADR (T-004). |
| **Outputs** | Published shared types consumed by both apps. |

### T-003: Add `role` column + status CHECK to schema

| Field | Value |
|-------|-------|
| **Epic** | Foundation |
| **Description** | Extend `apps/backend/src/db/schema.ts` `recordings`: add `role`/`position` `varchar(255)` (nullable — optional in PRD F3). Optionally constrain `status` with a CHECK enum (Drizzle enum) if not already enforced. Run `drizzle-kit push` to apply. |
| **Blocked by** | — |
| **Blocks** | T-002, T-005 |
| **Parallel group** | 0 |
| **Estimated effort** | 0.5 session |
| **Acceptance criteria** | `role` column exists and persists; existing rows remain valid; `pnpm --filter @interview-recorder/backend db:migrate` applies cleanly; `docs/api.md` data model table updated to include `role`. |
| **Inputs** | Existing `schema.ts`. |
| **Outputs** | Migrated schema with `role`. |

### T-004: Sync-flow ADR (client-driven vs server-driven)

| Field | Value |
|-------|-------|
| **Epic** | Foundation |
| **Description** | Decide and document who owns the sync state machine and audio bytes. Two viable models: **(A) Client-driven**: mobile holds audio locally with status `local`, drives `uploading`→`synced`, backend just receives the final file and metadata in one upload (or a create-metadata + upload-audio two-step). **(B) Server-driven**: backend creates the record, mobile hands the file off, server-side fire-and-forget uploads (current scaffold). Pick the model that best satisfies PRD §5 F5 (mobile background upload, status transitions, manual re-upload of `failed`, resume on relaunch). Write a short ADR note appended to README's "Architecture Decisions". |
| **Blocked by** | — |
| **Blocks** | T-002, T-006 |
| **Parallel group** | 0 |
| **Estimated effort** | 0.5 session |
| **Acceptance criteria** | An ADR paragraph specifying the chosen model, the endpoint shape it implies (one-step multipart vs two-step), and where `status` is the source of truth (DB vs client). |
| **Inputs** | PRD §5 F5, §7, existing `routes/recordings.ts` + `services/sync.ts`. |
| **Outputs** | ADR; contracts for T-002 and flow for T-006. |

> **Recommended:** A (client-driven) — it matches F5's wording ("uploads
> … from the mobile client", "status: local→uploading→synced/failed") and
> the manual re-upload story. The current server-side fire-and-forget
> cannot resume on app relaunch and has no client retry across cold
> starts, contradicting the sync-integrity pillar.

### T-005: Auth seam + per-user scoping

| Field | Value |
|-------|-------|
| **Epic** | Backend API |
| **Description** | Implement a Fastify preHandler/middleware that resolves `req.userId` from an auth header (stub per T-021 — likely a `x-user-id`/`Authorization: Bearer <dev-token>` mapping to a known dev user, seeded). Add a `users` seed row. Refactor every recording route to **scope by `userId`**: list `where(eq(userId, …))`, get/delete/retry must verify the recording belongs to the requesting user (404 otherwise, to avoid leaking existence). Remove the hardcoded `00000000-…-000000000001` placeholder. |
| **Blocked by** | T-002, T-003 |
| **Blocks** | T-006, T-007, T-008 |
| **Parallel group** | 2 |
| **Estimated effort** | 1–1.5 sessions |
| **Acceptance criteria** | All 5 routes return only the requesting user's recordings; a request with another user's id cannot read/delete/retry a recording it doesn't own (404); unauthenticated requests are rejected (401); a seeded dev user exists; per-user privacy user story (§6) satisfied. |
| **Inputs** | Shared types (T-002), stub-auth decision (T-021). |
| **Outputs** | Auth middleware + per-user-scoped route handlers. |

### T-006: Align upload/retry flow to ADR

| Field | Value |
|-------|-------|
| **Epic** | Backend API |
| **Description** | Refactor `routes/recordings.ts` + `services/sync.ts` to the model chosen in T-004. If client-driven (recommended): split into **`POST /api/recordings`** (metadata-only create, status `local`, returns `id`) and **`POST /api/recordings/:id/audio`** (multipart upload; transitions `local`→`uploading`→`synced`, or `failed` on non-transient error). Re-upload `POST /api/recordings/:id/retry` accepts the audio again (status must be `failed`, else 400). Make `sync.ts` classify transient vs non-transient (network/5xx = transient; 4xx/auth = non-transient) and expose retry counts to the client. Bound server-side guard to never leave a row stuck in `uploading` (e.g., TTL reaper or lease). |
| **Blocked by** | T-004, T-005 |
| **Blocks** | T-014, T-015, T-008 |
| **Parallel group** | 3 |
| **Estimated effort** | 1.5 sessions |
| **Acceptance criteria** | Two-step happy path: metadata create returns `id`; audio upload transitions DB status to `synced` and S3 object exists; failed transient upload leaves record back at `local` (client retries); a 4xx upload leaves record `failed`; `/retry` only works for `failed`; no row can stay `uploading` indefinitely. |
| **Inputs** | ADR (T-004), auth seam (T-005), shared types (T-002). |
| **Outputs** | Final upload + retry contract. |

### T-007: Backend audio download/serve endpoint

| Field | Value |
|-------|-------|
| **Epic** | Backend API |
| **Description** | Add `GET /api/recordings/:id/audio` that streams (or pre-signs a URL to) the S3 object, **only for the owning user** (per T-005). Use `@aws-sdk/s3-request-presigner` for a short-lived signed URL, or stream the body via `GetObject` for a simpler path that works against LocalStack. Document the choice in `docs/api.md`. |
| **Blocked by** | T-005 |
| **Blocks** | T-018, T-008 |
| **Parallel group** | 3 |
| **Estimated effort** | 0.5–1 session |
| **Acceptance criteria** | Owner can download their audio; non-owner gets 404; LocalStack and real S3 both work (endpoint switch via env); endpoint documented. |
| **Inputs** | Auth seam (T-005), existing `storage.ts` helpers. |
| **Outputs** | Download endpoint for mobile playback (T-018). |

### T-008: Backend unit tests

| Field | Value |
|-------|-------|
| **Epic** | Backend (bonus deliverable) |
| **Description** | Add Vitest tests covering: per-user scoping (negative + positive), upload state transitions (`local`→`uploading`→`synced`/`failed`), retry-only-on-`failed` guard, transient-vs-non-transient classification, and the no-stuck-`uploading` guard. Use a test DB / LocalStack; keep tests fast. Wire into `mise run test:backend`. |
| **Blocked by** | T-006, T-007 |
| **Blocks** | T-020 |
| **Parallel group** | 4 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | `mise run test:backend` passes; ≥ tests for each acceptance criterion of T-005 and T-006; cross-user isolation asserted. |
| **Inputs** | Finalized backend routes (T-006, T-007). |
| **Outputs** | Passing test suite (bonus deliverable). |

### T-009: Mobile API client service

| Field | Value |
|-------|-------|
| **Epic** | Mobile data |
| **Description** | Create `apps/mobile/src/services/api.ts`: a typed fetch wrapper that reads `EXPO_PUBLIC_API_URL`, injects the auth header (per T-021 stub), and exposes typed methods for the backend contract from T-006: `createRecording(metadata)`, `uploadAudio(id, fileUri)`, `retryUpload(id, fileUri)`, `listRecordings()`, `getRecording(id)`, `deleteRecording(id)`, `getAudioUrl(id)`/`streamAudio`. Parse errors via shared `ApiError`. |
| **Blocked by** | T-002 |
| **Blocks** | T-014, T-015 |
| **Parallel group** | 2 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | All methods typed against shared types; 401/4xx errors surface as `ApiError`; multipart upload uses `FormData`/Blob from the file URI; works against the running backend in dev. |
| **Inputs** | Shared types (T-002), final backend contract (T-006). |
| **Outputs** | Typed mobile API layer. |

### T-010: Mobile recording service (expo-av)

| Field | Value |
|-------|-------|
| **Epic** | Mobile capture (F1) |
| **Description** | Build `apps/useRecording` hook + service wrapping `expo-av` `Audio.Recorder`: request mic permissions; **start** writes to a persistent FileSystem location immediately (see T-012); **pause/resume** operate on the single recording (single-file-with-gaps model — do **not** create a new file on resume); **stop** finalizes and returns `{ fileUri, durationMs }`. Configure `Audio.RecordingOptions` per T-021's audio-format decision (default AAC/m4a, voice bitrate). Emit recording state (`idle`/`recording`/`paused`/`stopped`/`error`). |
| **Blocked by** | T-001, T-021 |
| **Blocks** | T-011, T-012, T-013, T-017 |
| **Parallel group** | 1 |
| **Estimated effort** | 1–1.5 sessions |
| **Acceptance criteria** | One session → exactly one audio file on disk with correct duration; pause/resume does not create a second file and does not corrupt playback; permissions handled; recording state transitions are queryable. |
| **Inputs** | Audio-format decision (T-021). |
| **Outputs** | Reusable recording hook + service. |

### T-011: Live waveform + elapsed timer UI

| Field | Value |
|-------|-------|
| **Epic** | Mobile capture (F2) |
| **Description** | Build a recording screen UI driven by T-010's hook: large record/pause/stop buttons, an elapsed-time display (MM:SS) that excludes paused gaps, and a live waveform visualization derived from `expo-av` metering levels (or a lightweight animated bar fallback). Whitespace/accessibility labels on all controls. |
| **Blocked by** | T-010 |
| **Blocks** | — |
| **Parallel group** | 2 |
| **Estimated effort** | 1–1.5 sessions |
| **Acceptance criteria** | Timer reflects wall-clock active recording time (frozen during pause); waveform updates only while mic active; pause visually distinct from record; controls accessible (labels/roles). |
| **Inputs** | Recording hook (T-010). |
| **Outputs** | Recording screen. |

### T-012: Capture durability (flush + crash recovery)

| Field | Value |
|-------|-------|
| **Epic** | Mobile capture (F1, reliability pillar #1) |
| **Description** | Guarantee zero recording loss: write audio to a **persistent** FileSystem directory (not temp/cache) from the moment recording starts; on `stop` the file is finalized in place. On app **launch**, scan for any in-progress/partial session manifests and recover them as a `local` recording with its partial-duration audio. Register an AppState/KillTaskResilience hook so a backgrounding or unexpected exit still leaves recoverable audio. This is the PRD's non-negotiable #1. |
| **Blocked by** | T-010 |
| **Blocks** | T-013, T-019 |
| **Parallel group** | 2 |
| **Estimated effort** | 1–1.5 sessions |
| **Acceptance criteria** | Force-quitting the app mid-record → relaunch shows the partial recording in the list with recoverable audio (non-zero, plays back); no session ever leaves dangling partial audio unrecovered; temp vs persistent dir separation is clean. |
| **Inputs** | Recording hook (T-010). |
| **Outputs** | Durable capture + recovery-on-launch. |

### T-013: Mobile local storage repository

| Field | Value |
|-------|-------|
| **Epic** | Mobile data (F4) |
| **Description** | Build `apps/mobile/src/services/localStore.ts`: a persistent manifest of recordings (id, metadata, status, fileUri, durationMs, createdAt). Prefer a lightweight durable store — `expo-file-system` JSON manifest or `expo-sqlite` (the latter scales better to many recordings). Expose CRUD + `setStatus(id, status)` + `list()`. Must survive relaunch and be the source of truth on-device for the sync engine and list/detail views. Seed it from T-012's recovery scan. |
| **Blocked by** | T-010, T-012 |
| **Blocks** | T-014, T-015, T-016, T-017 |
| **Parallel group** | 3 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | Restart app → all prior recordings (incl. recovered partials) reappear with correct status and file refs; `setStatus` persists; concurrent reads/writes are safe; ≥ 50 recording manifest queries perform acceptably. |
| **Inputs** | Recording hook (T-010), durability layer (T-012). |
| **Outputs** | Local persistence API for the rest of the app. |

### T-014: Mobile recordings list view

| Field | Value |
|-------|-------|
| **Epic** | Mobile management (F4) |
| **Description** | Build the recordings list screen: rows show interviewee name, role, status badge (`local`/`uploading`/`synced`/`failed`), duration, relative time. Actions: **delete** (removes local file **and** calls backend delete → T-006), **retry** (visible only for `failed`; triggers T-015's manual re-upload). Empty state. Pull-to-refresh optional. |
| **Blocked by** | T-013, T-009, T-006 |
| **Blocks** | T-016 |
| **Parallel group** | 4 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | Status badges match local-store truth at all times; delete removes from list and backend; retry only enabled on `failed` and only for caller's own recordings; list re-renders on status changes from the sync engine. |
| **Inputs** | Local repo (T-013), API client (T-009), backend flow (T-006). |
| **Outputs** | Recordings list screen. |

### T-015: Mobile sync engine (state machine + backoff)

| Field | Value |
|-------|-------|
| **Epic** | Mobile sync (F5, reliability pillar #2) |
| **Description** | Build `apps/mobile/src/services/syncEngine.ts`: consumes the local repo and API client. On finalize/relaunch, find `local` recordings and upload via T-009, driving status `local`→`uploading`→`synced`/`failed`. Resumable across cold starts (no stuck `uploading`; on app start, any record claiming `uploading` is reset to `local` and requeued). Exponential backoff **1s→2s→4s→8s→16s, 5 attempts** matching PRD §4/§5. Classify errors (transient: network/5xx → retry; non-transient: auth/4xx → terminal `failed`). Expose a manual `retry(id)` for T-014. Background-safe (works while app is foregrounded; true background upload is future scope). |
| **Blocked by** | T-009, T-013, T-006 |
| **Blocks** | T-019 |
| **Parallel group** | 4 |
| **Estimated effort** | 1.5–2 sessions |
| **Acceptance criteria** | Happy path: a finished recording ends `synced`; offline: stays `local`/retries with backoff and resumes on connectivity; kill app mid-upload → relaunch resumes and completes; non-transient error → terminal `failed` after 5 attempts → manual retry succeeds; no recording stuck in `uploading` across a relaunch. |
| **Inputs** | API client (T-009), local repo (T-013), backend flow (T-006). |
| **Outputs** | The sync engine — the second reliability pillar. |

### T-016: Mobile detail view shell

| Field | Value |
|-------|-------|
| **Epic** | Mobile management (F4) |
| **Description** | Build the recording detail screen: full metadata (interviewee name, role, tags, notes), status badge, duration, timestamps, file size. Wire to `expo-router` navigation from the list (T-014). Leave a clearly-marked placeholder region where playback (T-018) will mount. |
| **Blocked by** | T-014, T-013 |
| **Blocks** | T-018 |
| **Parallel group** | 5 |
| **Estimated effort** | 0.5–1 session |
| **Acceptance criteria** | Navigating from a list row opens the correct detail; all four metadata fields render; metadata edits from T-017 reflect here; placeholder for playback is present. |
| **Inputs** | List view (T-014), local repo (T-013). |
| **Outputs** | Detail screen (playback slot reserved). |

### T-017: Mobile metadata capture form

| Field | Value |
|-------|-------|
| **Epic** | Mobile capture (F3) |
| **Description** | Build a metadata form reachable from the recording screen on stop (and editable on the detail screen until finalized): **interviewee name (required)**, role/position (optional), tags (multi-value, freeform add/remove), notes (free text, multiline). Validate required field; persist into the local repo (T-013); sent on upload via T-009. |
| **Blocked by** | T-013, T-010 |
| **Blocks** | T-020 |
| **Parallel group** | 4 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | Empty interviewee name blocks save with inline validation; tags add/remove works; metadata persists locally and is included verbatim in the upload payload; editable on detail before finalization. |
| **Inputs** | Local repo (T-013), recording flow (T-010). |
| **Outputs** | Metadata capture UX (F3). |

### T-018: Mobile in-app playback

| Field | Value |
|-------|-------|
| **Epic** | Mobile playback (F6) |
| **Description** | Mount a seekable audio player into the detail screen (T-016) using `expo-av` `Audio.Sound`: play/pause, seek bar, time display. Source: the local file (T-013) when present, else `GET /api/recordings/:id/audio` (T-007) for remote-only recordings. Works offline for locally-present audio. |
| **Blocked by** | T-016, T-007 |
| **Blocks** | T-020 |
| **Parallel group** | 6 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | Play/pause/seek work on both local and remote audio; seeking across long files is responsive; offline playback succeeds when the local file exists; UI reflects loading/error states gracefully. |
| **Inputs** | Detail view (T-016), download endpoint (T-007), local repo (T-013). |
| **Outputs** | In-app playback (F6). |

### T-019: Reliability integration test

| Field | Value |
|-------|-------|
| **Epic** | Reliability (both pillars) |
| **Description** | An end-to-end reliability pass proving both non-negotiables: (1) **crash-mid-record** → relaunch recovers the partial audio as a `local` recording; (2) **kill-mid-upload** → relaunch resumes and reaches `synced`; (3) **offline-then-online** → backoff retries to `synced`; (4) **non-transient error** → terminal `failed` after 5 attempts → manual retry → `synced`. Document reproduction steps in README. If Maestro/Detox is too heavy for 2-day budget, scripted manual test steps + backend unit tests (T-008) covering server-side transitions are acceptable. |
| **Blocked by** | T-015, T-012 |
| **Blocks** | T-020 |
| **Parallel group** | 5 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | All four scenarios pass and are evidenced (logs, screenshots, or automated test output); recorded as a checklist in README's "Reliability" section. |
| **Inputs** | Capture durability (T-012), sync engine (T-015). |
| **Outputs** | Proof of the two trust pillars. |

### T-020: Deliverables (README, API docs, test wiring)

| Field | Value |
|-------|-------|
| **Epic** | Delivery |
| **Description** | Finalize the assignment deliverables: (1) `README.md` — setup steps, architecture summary, **local storage strategy**, key design decisions (incl. T-004 sync-flow ADR), reliability results (link T-019), **known limitations** (stub auth, no background upload beyond foreground, no transcription, future scope). (2) `docs/api.md` — refresh to match the final contract from T-006/T-007 (two-step create/upload, retry, audio download, per-user scoping note). (3) Wire `mise run test`/`lint` to cover mobile unit tests if any. |
| **Blocked by** | T-008, T-017, T-018, T-019 |
| **Blocks** | — |
| **Parallel group** | 7 |
| **Estimated effort** | 1 session |
| **Acceptance criteria** | A reviewer can clone, run `mise install && pnpm install && mise run db:up && mise run db:migrate`, start backend + mobile, and complete a record→sync→playback loop by following the README; `docs/api.md` matches the implemented routes; known limitations list stub auth and the trust-pillar test results. |
| **Inputs** | All feature + test tasks. |
| **Outputs** | The three required deliverables. |

### T-021: Resolve open questions (decisions gate)

| Field | Value |
|-------|-------|
| **Epic** | Foundation |
| **Description** | Decide the PRD §11 open questions that gate implementation, and record outcomes in README's "Decisions": **(a) auth stub depth** — confirm whether the deliverable uses a hardcoded dev user vs a configurable per-interviewer bearer token (recommended: a small `x-user-id` header → seeded user, swappable for a real provider later); **(b) audio format/quality** — confirm AAC/m4a, voice bitrate (~64–96 kbps, 44.1 kHz mono) vs alternatives; **(c) accessibility target** — confirm "reasonable mobile a11y" suffices (no formal WCAG level for MVP); **(d) max duration / storage quota** — confirm none enforced for MVP (future scope); **(e) file integrity / resumable uploads** — confirm they remain future scope. |
| **Blocked by** | — |
| **Blocks** | T-005, T-010 |
| **Parallel group** | 0 |
| **Estimated effort** | 0.5 session |
| **Acceptance criteria** | A short "Decisions" section in README resolves (a)–(e) with the chosen answer and a one-line rationale each; T-005 and T-010 can proceed without further sign-off. |
| **Inputs** | PRD §11. |
| **Outputs** | Decisions that unblock auth and recording-config tasks. |

## Notes & Assumptions

- **Neither-grill-me-needed:** the PRD is treated as source of truth; ambiguities are captured here, not re-litigated.
- **Backend status as source of truth:** PRD F5 describes the *client* holding `local`. The backend should still store a `status` column for its own view (the recording is `synced` server-side once the audio lands). T-004's ADR reconciles the two; T-006 implements it.
- **Effort is heuristic** (one session ≈ 1–3 focused hours). The 2-day assignment budget implies ~the foundation (group 0–1) and capture+sync spine (groups 2–4, critical path) must ship first; metadata (T-017) and playback (T-018) are trimmable if time runs short — they are explicitly the last MVP features on a non-critical branch.
- **Parallelism payoff:** Once T-002 ships shared types, **Track C (backend: T-005→T-006/T-007→T-008)** and **Tracks D/E (mobile: T-011, T-012, T-009)** can be developed concurrently by two agents before joining at T-013/T-014/T-015.