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

Uploads happen asynchronously after the DB record is created. The sync
service implements exponential backoff (1s → 2s → 4s) and transitions
status through `local` → `uploading` → `synced` / `failed`.

## Known Limitations

- **Authentication**: Placeholder only — no real auth is implemented.
- **Background uploads**: Uploads are fire-and-forget within the server
  process. A production system would use a job queue (BullMQ, etc.).
- **Mobile local storage**: Not yet implemented — recordings currently
  live in memory / temp files.
- **Pre-signed URLs**: Download endpoint returns a placeholder URL.
  Real pre-signed URLs should be generated server-side.

## Potential Improvements

- Add EAS Build config for iOS/Android distribution
- Implement proper auth (Supabase Auth, Clerk, or custom JWT)
- Job queue (BullMQ + Redis) for reliable background uploads
- Add file integrity validation (checksums, resumable uploads)
- Offline-first mobile with local SQLite (e.g., WatermelonDB)
- Expo E2E tests with Detox or Maestro
