# PRD: Interview Recorder

> **Status:** Draft
> **Date:** 2026-07-03
> **Author:** auto-generated (pi PRD skill)

## 1. Executive Summary

**Interview Recorder** is a mobile app plus backend that lets a team of job
interviewers capture, store, and sync interview sessions reliably. Each
interviewer uses their own device to record a candidate conversation, attach
lightweight metadata (interviewee name, role, tags, notes), and have the
audio automatically synchronize to a shared cloud backend — even across
flaky or interrupted networks. The product is **recorder-first and
sync-reliable**: no transcription, no AI summaries, no sharing; just clean
capture, durable local storage, dependable upload, and in-app listen-back.

This is being delivered as a take-home assignment with a **2-day time
budget**. The architecture (Expo React Native + Fastify + PostgreSQL +
S3/LocalStack, Turborepo monorepo) is already decided and out of scope for
this document; this PRD focuses exclusively on **product requirements**.

The two non-negotiable reliability pillars are co-equal: (1) **never lose a
recording** to an app crash or mid-session interruption, and (2) **never
silently fail to sync** — every recording reaches a truthful terminal state
(`synced`, or `failed` only after bounded retries with manual re-upload).
Either failure mode would destroy user trust equally.

## 2. Problem Statement

Interviewers today record candidate conversations with ad-hoc tools — a
phone voice memo, a Zoom local recording, a handheld recorder — then
manually move files somewhere safe. This workflow breaks down in three
ways:

- **Capture is fragile.** If the recording app crashes, the phone dies,
  or the session is interrupted, audio is often partially or wholly lost.
  There is no recoverability story.
- **Sync is unreliable and opaque.** Uploads fail on flaky networks, fail
  silently, or get stuck "uploading" forever. Interviewers don't know
  which recordings have safely reached the backend and which need
  attention.
- **Recall is poor.** Recordings pile up with no metadata, no per-recording
  context, and no easy way to find "the candidate I screened for SRE last
  Tuesday" — let alone listen back in-product.

Interview Recorder exists to make each of those three steps trustworthy:
record without losing audio, sync without lying about state, and listen
back without leaving the app.

## 3. Target Audience

- **Primary personas:**
  - *Interviewer (operator)* — records candidate sessions, adds metadata,
    reviews past recordings. The direct daily user.
- **Secondary personas:**
  - *Hiring manager / colleague* — (future scope) may later need access to
    a recording; today the product treats recordings as private to the
    interviewer who created them.
  - *Backend / platform maintainer* — operates the sync service and
    storage; consumes the API.
- **Stakeholders:**
  - The single company team adopting the tool (flat; no org/admin model).
  - The assignment reviewer (deliverable consumer).
- **User demographics:** Technical interviewers, small team (single
  company), one device per interviewer, comfortable with mobile apps.
  Network conditions range from office Wi-Fi to cellular to dead spots
  between buildings.

## 4. Goals & Success Metrics

### Business Goals
- Deliver a trustworthy interview-recording tool usable by a small
  interviewer team within a 2-day build window.
- Establish a recorder-first product line distinct from
  transcription/AI-note competitors.

### Product Metrics
- **Capture durability rate** — fraction of started sessions whose audio is
  fully recoverable after the app exits without graceful stop.
- **Sync completion rate** — fraction of `local` recordings that reach
  `synced` (given network availability).
- **Sync truthfulness** — fraction of recordings whose displayed status
  matches ground truth (no stuck `uploading`, no silent `synced`-but-missing).
- **Time-to-first-recording** — from app open to recording start.

### Success Criteria
- **Non-negotiable #1 (capture durability):** Zero recording loss when the
  app is killed, crashes, or is interrupted mid-session. The recorded
  audio up to the point of interruption **must** be recoverable from
  local storage on next launch.
- **Non-negotiable #2 (sync integrity):** 100% of recordings that reach
  `local` eventually reach a terminal `synced` state, *or* a terminal
  `failed` state only after bounded auto-retries (≈5 attempts,
  exponential backoff 1s → 2s → 4s → 8s → 16s) on non-transient errors.
  Recordings are never silently dropped and never stuck in `uploading`.
- **MVP feature completeness:** All five MVP features (§5) functional end
  to end, demonstrated via the happy path plus the crash-and-recover and
  offline-sync edge cases.

## 5. Features & Requirements

### MVP (must-have)

**F1. Recording session control**
- Start, pause (single-file with gaps — pause mutes/stops the mic and
  appends on resume; produces **one** audio file per session), resume,
  stop.
- Acceptance: a stopped session yields exactly one audio file on local
  storage with a known duration; pause/resume does not create additional
  files or corrupt the stream.

**F2. Live recording indicators**
- Real-time elapsed timer and live waveform visualization during active
  recording.
- Acceptance: timer reflects wall-clock session length (excluding paused
  gaps, per the single-file-with-gaps model); waveform updates while mic
  is active and freezes during pause.

**F3. Session metadata capture**
- Per recording: interviewee name (text, required), role/position (text,
  optional), freeform tags (multi-value, optional), notes (free text,
  optional). Metadata is editable until the recording is finalized.
- Acceptance: metadata is persisted alongside the recording and travels
  with it on sync; list and detail views render all four fields.

**F4. Local storage management**
- Recordings are stored durably on device before **and after** upload.
  List view shows all recordings with status, duration, interviewee, and
  role; supports delete and re-upload (for `failed` items). Detail view
  shows full metadata + status + audio.
- Acceptance: after force-quit / relaunch, all previously started
  recordings (including interrupted ones) appear with their metadata and
  partial audio recoverable; deleting a recording removes local **and**
  server-side artifacts.

**F5. Background synchronization with auto-retry**
- After a DB record is created, the audio file uploads asynchronously in
  the background. Status transitions: `local` → `uploading` → `synced`
  (success) or `local` → `uploading` → `local` (transient retry) →
  ... → `failed` (terminal, after bounded retries on non-transient
  error).
- Auto-retry with exponential backoff (1s → 2s → 4s → 8s → 16s, ≈5
  attempts). Network-down counts as transient; auth failure / 4xx counts
  as non-transient (terminal `failed`).
- Manual **re-upload** action available for any recording in `failed`.
- Acceptance: killing the app mid-upload does not lose the recording;
  relaunch resumes sync; no recording is silently dropped or stuck in
  `uploading` indefinitely.

**F6. In-app playback**
- Seekable audio player on the recording detail screen for synced (and
  optionally local) recordings.
- Acceptance: user can play, pause, seek within any recording they own;
  playback works offline for recordings whose audio is present locally.

### Backend MVP

- **REST API**, per-user scoped (all list/fetch endpoints filter by the
  authenticated interviewer):
  - `POST /recordings` (or `POST /recordings/:id/upload`) — receive audio
    file + metadata; returns recording record.
  - `GET /recordings` — list the requesting user's recordings (id,
    metadata, status, duration, created/updated timestamps).
  - `GET /recordings/:id` — single recording detail (full metadata,
    status, downloadable audio reference).
- **Storage**: metadata + file references in PostgreSQL (Drizzle ORM);
  audio files in S3 (LocalStack for local dev, real S3 for prod-equivalent).
- **Auth seam**: endpoints accept an auth header identifying the user;
  scope all queries by that user. (See §7 — auth provider is an open
  question; deliverable may ship a stub.)

### Future (could-have)

Each of the following is **out of scope for the MVP deliverable** but is
a deliberate future-scope candidate, not a permanent exclusion:

- **Transcription / AI summaries / semantic search over content** — the
  highest-value, most-likely next step; would let interviewers search
  across sessions by what was said.
- **Multi-tenant org model / RBAC / admin console** — supporting multiple
  companies, role-based access, and an admin UX. Required before the
  product becomes multi-customer SaaS.
- **Sharing & collaboration** — send a recording to a colleague,
  comments, shared folders. Directly contradicts the current
  per-interviewer-private model and would rework the auth/permission
  layer.
- **Real-time / live features** — live streaming, live transcription,
  concurrent multi-device recording of one session.

Additional future-scope items (not exclusions, just post-MVP):

- Job queue (BullMQ + Redis) for durable server-side background uploads
  replacing fire-and-forget in-process upload.
- File integrity validation (checksums) and resumable/multipart uploads
  for large/long interviews.
- Offline-first mobile with local SQLite (e.g., WatermelonDB) for richer
  offline queries.
- Wi-Fi-only / metered-network sync controls and per-recording sync
  pause/resume/cancel.
- Pre-signed download URLs generated server-side.
- E2E tests (Detox / Maestro) and proper auth (real provider).

## 6. User Stories

**Record**
> As an interviewer, I want to start, pause, and stop recording a
> candidate session so that the conversation is captured as a single audio
> file I can later review.

> As an interviewer, I want a live timer and waveform while recording so
> that I have confidence the mic is actually capturing and I can see how
> long we've been talking.

**Metadata**
> As an interviewer, I want to attach the candidate's name, role, tags, and
> notes to a recording so that I can find and recall the session later.

**Durability (edge case — happy-path adjacent)**
> As an interviewer, if the app crashes or my phone dies mid-interview, I
> want the audio captured up to that point to be recoverable on next
> launch so that no conversation is ever silently lost.

**Local management**
> As an interviewer, I want a list of all my past recordings with their
> status so that I know which are safely synced and which need attention.

> As an interviewer, I want to delete a recording so that it is removed
> from both my device and the backend.

**Sync**
> As an interviewer, I want uploads to happen in the background and retry
> automatically so that I don't have to baby-sit them across bad network.

> As an interviewer, I want to see each recording's true status
> (local / uploading / synced / failed) so that I'm never misled about
> what's safely backed up.

> As an interviewer, when a recording is marked `failed`, I want a manual
> re-upload action so that I can force another attempt after fixing the
  underlying problem.

**Playback**
> As an interviewer, I want to play back any of my synced recordings in-app
> so that I can listen back without leaving the tool.

**Per-user privacy (error-state boundary)**
> As an interviewer, I want to be confident that only my own recordings
> are visible to me through the API so that another interviewer in the
  team cannot access my candidate sessions.

## 7. Technical Requirements

> **Note:** Architecture and stack are already decided and are **not** in
> scope for this PRD. Listed here for completeness only.

- **Platform:** Mobile app (Expo React Native) + REST backend (Fastify on
  Node.js, TypeScript).
- **Architecture:** Monorepo (Turborepo + pnpm). Mobile and backend as
  separate workspace apps; shared types package between them.
- **Data storage:** PostgreSQL 16 (Drizzle ORM) for metadata + file
  references; S3 (LocalStack locally, real S3 in prod-equivalent) for
  audio blobs.
- **Networking:** Mobile uses URLSession/fetch-equivalent; backend
  exposes REST endpoints.
- **Audio capture:** `expo-av` (or equivalent) with native pause/resume on
  a single recording (single-file-with-gaps model, F1).
- **Sync engine:** Async background uploads from the mobile client; server
  stores record + file reference. (A server-side job queue is future
  scope.)
- **Security (auth):** Product requirement is **per-user accounts via a
  real auth provider** (email/password, magic link, or OIDC — provider
  TBD, see §11). All API endpoints are per-user scoped.
  - *Assumption / Known Limitation for the deliverable:* given the 2-day
    budget, the build may ship a **stub auth** (hardcoded dev user or a
    simple bearer token) sufficient to exercise per-user scoping. This is
    a **Known Limitation**, not the product spec. The product spec requires
    real per-user identity.
- **Audio format / quality:** target format and bitrate are an open
  question (§11). Default assumption: a single standard format (e.g., AAC
  / m4a) at a voice-suitable bitrate, balancing quality and upload size.

## 8. Non-functional Requirements

- **Reliability:**
  - Capture durability: zero recording loss on crash/kill/interruption;
    partial audio recoverable from local storage.
  - Sync integrity: 100% of `local` recordings reach a terminal `synced`
    or (after bounded retries) terminal `failed` state; no silent drops,
    no permanent `uploading`.
- **Scalability:** Single-team scale (small N of interviewers). Not a
  scale target for this deliverable; noted as future scope.
- **Accessibility:** Reasonable mobile accessibility (system font scaling,
  sufficient contrast, accessible labels on controls). Formal WCAG target
  not set for MVP — flag as Open Question (§11).
- **Maintainability:** TypeScript end to end; shared types package;
  modular route/service structure; README explaining key design decisions
  and known limitations.
- **Observability:** Client-side and server-side logging sufficient to
  diagnose sync failures. No formal tracing/metrics stack required for
  MVP (future scope).
- **Performance:** No formal latency SLA for MVP (deliberately not
  invented; future scope). Recording start should be near-instant;

  sync is eventual, not real-time.

## 9. Out of Scope (explicit exclusions)

> The items in §5 "Future" were originally listed as out-of-scope
> exclusions. Per alignment, they are **reframed as future scope** rather
> than permanent exclusions — i.e., they are out of the MVP deliverable
> but are intended candidate directions, not closed doors.

The only **permanent** MVP exclusions are:

- **Anything beyond the 2-day assignment deliverable that requires new
  infrastructure** not already in the decided stack (e.g., a new database,
  a new frontend framework). The stack is fixed.
- **Multi-device recording of a single session** (one session = one
  device's recording).
- **Cross-interviewer visibility** of recordings (recordings are private
  to the owner within the flat team).

## 10. Timeline & Milestones

| Milestone | Target | Deliverables |
|-----------|--------|--------------|
| Day 1 — Capture + storage core | End of day 1 | F1 (record/pause/stop), F2 (timer/waveform), F4 (local storage list/detail), capture-durability recovery on crash. |
| Day 1 — Backend skeleton | End of day 1 | Fastify API stubs, DB schema, S3/LocalStack upload path, per-user scoping seam (stub auth). |
| Day 2 — Sync engine | End of day 2 | F5 (background upload, status state machine, bounded auto-retry, manual re-upload); sync-integrity edge cases (kill mid-upload, network-down retries). |
| Day 2 — Metadata + playback | End of day 2 | F3 (metadata capture), F6 (in-app playback). |
| Day 2 — Deliverables | End of day 2 | README (setup, architecture, key decisions, known limitations), API docs (docs/api.md), bonus unit tests for core logic (recording management, sync state machine). |

**Prioritization** (from the assignment): stable recording and reliable
upload/sync mechanisms first. F1, F2, F4, F5 are the critical path; F3 and
F6 follow. Playback (F6) is MVP but sits last on the critical path so the
trust pillars ship first.

## 11. Open Questions

- **Auth provider**: email/password vs magic link vs OIDC (Google/Okta/etc.)?
  The product spec requires per-user identity; the choice of provider
  affects effort and the deliverable's stub.
- **Auth implementation depth in the deliverable:** confirm the agreed
  split — *product requirement = real per-user auth*; *deliverable ships
  a stub*. Is the stub a hardcoded dev user, or a configurable bearer
  token per interviewer?
- **Audio format & quality target**: which format (AAC/m4a, WAV?) and
  bitrate/sample-rate? Trade-off between fidelity and upload size over
  flaky networks.
- **Max recording duration / per-user storage quota:** does the product
  impose a ceiling? Affects local storage strategy and S3 cost model.
- **Accessibility target:** is a formal WCAG conformance level required
  for the MVP, or "reasonable mobile a11y" sufficient?
- **File integrity / resumable uploads:** confirm these stay in future
  scope (not MVP). Large/long interviews are the main risk if excluded.
- **Design / branding guidelines:** none provided. Default assumption is
  a clean, utilitarian mobile UI prioritizing recording clarity over
  visual polish. Confirm or supply brand/visual direction.

## 12. Appendix

- **Source assignment:** `Interview Recording Feature - Assignment.md`
  (project root).
- **Architecture decisions:** `README.md` (project root) — stack,
  structure, key design trade-offs (Turborepo, Expo, Fastify, Drizzle,
  LocalStack, sync-with-retry). Architecture is settled and **out of
  scope** for this PRD.
- **Existing API draft:** `docs/api.md` (project root).
- **Terminology:**
  - *Session* — one interview recording (one audio file + metadata).
  - *Interviewee* — the candidate being interviewed.
  - *Interviewer* — the authenticated user who owns the recording.
  - *Sync* — the asynchronous upload of a local recording to the backend
    and its transition to a terminal status.
- **Revision history:**
  - 2026-07-03 — Draft v1 (initial PRD from alignment session).