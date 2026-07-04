# Interview Recorder

Monorepo for a take-home assignment: a mobile app to record interview sessions
with reliable audio capture, local storage management, and backend
synchronization.

## Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native (Expo SDK 52) |
| Backend | Node.js + Fastify 5 + TypeScript |
| Database | PostgreSQL 16 (Drizzle ORM) |
| File storage | AWS S3 (LocalStack for local dev) |
| Monorepo | Turborepo + pnpm workspaces |
| Runtime | mise (Node 22, pnpm 9) |

## Project Structure

```
interview-recorder/
├── mise.toml                 # Tool versions & tasks
├── package.json              # Root workspace
├── pnpm-workspace.yaml
├── turbo.json                # Turborepo pipeline
├── docker-compose.yml        # PostgreSQL + LocalStack
├── apps/
│   ├── mobile/               # Expo React Native app
│   │   ├── app/              # File-based routing (expo-router)
│   │   └── src/              # Components, services, hooks
│   └── backend/              # Fastify API server
│       ├── src/
│       │   ├── config/       # Environment validation
│       │   ├── db/           # Schema & connection
│       │   ├── routes/       # API route handlers
│       │   └── services/     # S3 storage, sync logic
│       └── tests/
├── packages/
│   └── shared/               # Shared TypeScript types
└── docs/
    └── api.md                # API documentation
```

## Setup

### Prerequisites

- [mise](https://mise.jdx.dev) — runtime version manager
- [Docker](https://www.docker.com) — for PostgreSQL & LocalStack

### 1. Install tools

```bash
mise install
```

This installs Node 22 and pnpm 9.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment

```bash
cp .env.example .env
```

Edit `.env` as needed (defaults work out of the box with Docker Compose).

### 4. Start infrastructure

```bash
mise run db:up
```

Starts PostgreSQL (port 5432) and LocalStack S3 (port 4566).

### 5. Run database migrations

```bash
mise run db:migrate
```

### 6. Start development servers

```bash
# Backend (http://localhost:3000)
mise run dev:backend

# Mobile app (separate terminal)
mise run dev:mobile
```

## Available Tasks

Run `mise tasks` to list all available tasks.

| Task | Description |
|------|-------------|
| `dev` | Start all services (db + backend + mobile) |
| `dev:backend` | Backend dev server on :3000 |
| `dev:mobile` | Expo dev server with QR code |
| `build` | Build all packages |
| `test` | Run all tests |
| `lint` | Lint all packages |
| `db:up` | Start Docker services |
| `db:down` | Stop Docker services |
| `db:migrate` | Push Drizzle schema to DB |
| `db:studio` | Open Drizzle Studio (DB browser) |
| `clean` | Remove all build artifacts |

## API Documentation

See [docs/api.md](docs/api.md) for complete API reference.

## Architecture Decisions

### Monorepo with Turborepo + pnpm

Turborepo provides fast, cached builds across packages. pnpm workspaces
give strict dependency isolation. The `shared` package enforces a single
source of truth for types between mobile and backend.

### Expo (React Native)

Expo was chosen over bare React Native for faster iteration, built-in
monorepo support (SDK 52+), and simplified native module management
(e.g., `expo-av` for audio recording).

### Fastify over Express

Fastify is faster, has first-class TypeScript support, and a plugin
architecture that keeps routes modular and testable.

### Drizzle ORM

Lightweight, TypeScript-native ORM with a SQL-like query builder. Simpler
than Prisma for this scope, and migrations are just SQL.

### LocalStack for S3

LocalStack emulates S3 locally so the full upload pipeline works without
an AWS account. The same `@aws-sdk/client-s3` code works against both
LocalStack and real S3 (just swap the endpoint).

### Sync with Retry

**ADR — Client-driven sync model.** The mobile client is the source of
truth for sync status and owns the state machine. Recordings live on
device with status `local`; the client drives `uploading` → `synced`
(or `failed` after bounded retries). The backend is a store-and-serve
service: it receives the finalized audio and metadata, records the
server-side status, and serves audio back on demand. We deliberately
rejected the alternative *server-driven fire-and-forget* model (the
initial scaffold) because it cannot resume uploads across app cold
starts, has no client-side retry across relaunches, and cannot honor the
PRD's manual re-upload-of-`failed` story — all of which are required by
the sync-integrity pillar (PRD §4).

The backend API therefore uses a **two-step upload** contract:

1. `POST /api/recordings` — metadata-only create; returns `id` with
   status `local`. No audio yet.
2. `POST /api/recordings/:id/audio` — multipart file upload; transitions
   the recording to `synced` on success or `failed` on a non-transient
   error. Transient errors (network / 5xx) leave the client free to
   retry; non-transient errors (auth / 4xx) terminalize to `failed`.
3. `POST /api/recordings/:id/retry` — re-accepts the audio for a
   recording in `failed` status (else `400`).

The mobile sync engine implements exponential backoff (1s → 2s → 4s →
8s → 16s, 5 attempts) matching PRD §4/§5, classifies transient vs
non-transient errors, and resets any row claiming `uploading` back to
`local` on app relaunch so no recording is ever stuck in `uploading`.

A server-side job queue (BullMQ + Redis) for true background upload is
future scope (see §Potential Improvements).

## Decisions (Open Questions Resolved)

The following resolve the PRD §11 open questions for the MVP deliverable:

- **Auth stub depth:** Per-interviewer stub via an `x-user-id` request
  header that resolves to a seeded dev user (a couple of dev users are
  seeded for testing). Swappable for a real provider (magic link / OIDC)
  later — the per-user scoping seam is real. The PRD's *product
  requirement* of real per-user auth remains; the stub is a **Known
  Limitation** of this 2-day deliverable, not the spec.
- **Audio format & quality:** AAC in an `.m4a` container, mono, 44.1 kHz,
  ~96 kbps — a voice-suitable balance of fidelity and upload size over
  flaky networks (uses `expo-av` defaults).
- **Accessibility target:** Reasonable mobile accessibility (system font
  scaling, sufficient contrast, accessibility labels on controls). No
  formal WCAG conformance level targeted for the MVP.
- **Max recording duration / storage quota:** None enforced for the MVP
  (deferred to future scope). The 100 MB multipart cap on the backend is
  the only practical ceiling.
- **File integrity / resumable uploads:** Confirmed out of MVP (future
  scope). Large/long interviews are the main residual risk.

## Reliability Tests

The two non-negotiable pillars (PRD §4) are covered by unit tests for the
backend state transitions (`apps/backend/tests/recordings.test.ts`, 24 tests:
per-user scoping, `local → uploading → synced/failed`, `/retry`-only-on-
`failed`, transient-vs-non-transient classification, ownership isolation) and
by the four manual end-to-end scenarios below. Maestro/Detox E2E is future
scope; the mobile sync engine's state machine mirrors the backend's and is
exercised through these flows.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | **Crash mid-record** (capture durability) | 1. `mise run dev:mobile`, start a new recording. 2. From the OS, force-quit the Expo app while recording. 3. Reopen the app. | The interrupted session appears in `My Recordings` with status `Local` and recoverable partial audio (plays back in detail). |
| 2 | **Kill mid-upload** (sync integrity) | 1. Record + save a session; ensure backend is running and network up. 2. While status shows `Uploading…`, force-quit the Expo app. 3. Reopen the app. | Status resets to `Local` on relaunch (no stuck `Uploading`), the sync engine requeues, and the recording reaches `Synced`. |
| 3 | **Offline → online** (backoff retries) | 1. Stop the backend (`mise run db:down` or kill the API process). 2. Record + save a session; observe it stays `Local` and retries with backoff (1s→2s→4s→8s→16s). 3. Restart the backend. | The recording auto-syncs to `Synced` within ~30 s of backend availability. |
| 4 | **Non-transient → terminal `failed` → manual retry** | 1. Mock a non-transient failure (e.g., revoke auth by changing `EXPO_PUBLIC_USER_ID` to an unknown UUID). 2. Record + save; observe it transitions to `failed` after 5 attempts. 3. Restore the valid user id and tap `Retry` in `My Recordings`. | Status is terminal `failed`; manual `Retry` re-sends the audio and reaches `Synced`. |

Run `mise run test:backend` to execute the 24 unit tests backing the state
machine and per-user scoping.

## Known Limitations

- **Authentication**: Placeholder only — no real auth is implemented.
- **Background uploads**: The mobile sync engine runs while the app is
  foregrounded. True background-task uploads (iOS background tasks / Android
  foreground services) and a server-side job queue (BullMQ + Redis) are
  future scope.
- **Mobile local storage**: Recordings live on device in a durable JSON
  manifest at `documentDirectory/recordings-manifest.json` and individual
  `.m4a` audio files under `documentDirectory/recordings/`. The manifest is
  the on-device source of truth for sync status.
- **Pre-signed URLs**: The audio download endpoint now generates a real
  short-lived pre-signed S3 URL via `@aws-sdk/s3-request-presigner`. Works
  against both LocalStack (dev) and real S3. (Earlier drafts returned a
  placeholder URL; that limitation is resolved.)

- **Authentication**: Per-interviewer stub via `x-user-id` request header
  resolved against seeded dev users. The per-user scoping seam is real, but
  the deliverable does not implement a real auth provider (magic link / OIDC).
  This is a **Known Limitation**, not the product spec — see Decisions above.

## Potential Improvements

- Add EAS Build config for iOS/Android distribution
- Implement proper auth (Supabase Auth, Clerk, or custom JWT)
- Job queue (BullMQ + Redis) for reliable background uploads
- Add file integrity validation (checksums, resumable uploads)
- Offline-first mobile with local SQLite (e.g., WatermelonDB)
- Expo E2E tests with Detox or Maestro
