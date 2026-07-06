# Authentication (Tinyauth over HTTP + session JWT)

Interviewers authenticate with a **username and password**. Credentials live in
**[Tinyauth]**, which runs over **plain HTTP** (no HTTPS, no Caddy, no
`/etc/hosts` edits, no cert trust). The mobile app posts credentials to the
backend; the backend validates them against Tinyauth, issues a session JWT, and
the mobile sends that JWT as `Authorization: Bearer` on every subsequent call.

```
 mobile (Expo)                  backend (Fastify)                 Tinyauth (HTTP)
      |                              |                                    |
      |  1. POST /api/auth/login     |                                    |
      |    { username, password }    |                                    |
      |----------------------------->|                                    |
      |                              |  2. GET /api/auth/traefik           |
      |                              |     Authorization: Basic <u:p>     |
      |                              |----------------------------------->|
      |                              |  3. 200 + Remote-User/Remote-Email |
      |                              |<-----------------------------------|
      |                              |  4. upsert user, sign HS256 JWT    |
      |  5. { token, user }          |                                    |
      |<-----------------------------|                                    |
      |                              |                                    |
      |  6. GET /api/recordings  Authorization: Bearer <jwt>            |
      |--------------------------------------------------------------->   |
      |  7. { data: [...] }          | (verifies JWT with JWT_SECRET)     |
      |<---------------------------------------------------------------|
```

## Why this shape

- **Tinyauth over HTTP, not HTTPS.** Only Tinyauth's *OIDC server* mode
  requires HTTPS. Its username/password / forward-auth / Basic-auth mode works
  over plain HTTP — so there's no Caddy, no local CA, no `tls internal`, and
  nothing to trust. Fully reproducible: `docker compose up tinyauth` and it's
  on `http://localhost:3001`.
- **No mobile ↔ Tinyauth contact.** The mobile never talks to Tinyauth; only
  the backend does. So Tinyauth doesn't need to be reachable from the device,
  and there's no cookie/redirect flow for React Native `fetch` to struggle
  with (RN doesn't share cookies with the in-app browser, which is why the
  forward-auth/cookie and OIDC-browser models were a poor fit for a mobile API
  client).
- **Backend session JWT, not per-request Basic auth.** The password is sent
  once (at login) and only the backend relays it to Tinyauth. Subsequent
  requests carry a short-lived HS256 JWT, so Tinyauth isn't hit per request
  and the password isn't retransmitted.
- **No client secret in the app** (unlike the OIDC-server approach, where
  Tinyauth's token endpoint is secret-based). The mobile holds only its own
  session JWT.

## Components

| Where | Change |
|-------|--------|
| `docker-compose.yml` | `tinyauth` service over HTTP (`:3001`), `TINYAUTH_AUTH_USERS` seeds 3 dummy accounts |
| `apps/backend/src/services/auth.ts` | `validateCredentials` (calls Tinyauth forward-auth), `issueSessionToken`/`verifySessionToken` (jose HS256), `authHook` |
| `apps/backend/src/routes/auth.ts` | `POST /api/auth/login`, `GET /api/auth/me` |
| `apps/backend/src/db/schema.ts` | `users.username`/`email`/`name` (no password hash — Tinyauth owns credentials) |
| `apps/mobile/src/auth/AuthContext.tsx` | posts credentials → stores JWT in `expo-secure-store` |
| `apps/mobile/src/services/api.ts` | `Authorization: Bearer <jwt>` (+ 401 → re-login) |
| `apps/mobile/app/login.tsx` + `_layout.tsx` | login form + auth gate |

## Dummy accounts (zero-config)

Three accounts are seeded automatically via `TINYAUTH_AUTH_USERS` in
`docker-compose.yml` (bcrypt hashes generated with `tinyauth user create
--docker`). They exist as soon as `mise run auth:up` runs — no setup needed:

| Username | Password |
|----------|----------|
| `interviewer1` | `pass1` |
| `interviewer2` | `pass2` |
| `interviewer3` | `pass3` |

## Local-dev setup

```bash
# 1. Start Postgres + LocalStack + Tinyauth
mise run db:up        # postgres + localstack
mise run auth:up      # tinyauth on http://localhost:3001

# 2. Push the DB schema (adds users.username etc.)
mise run db:migrate

# 3. Start the backend (reads TINYAUTH_URL + JWT_SECRET from .env)
mise run dev:backend

# 4. Start the mobile app
mise run dev:mobile
```

Sign in on the mobile app with any dummy account. That's it — no `/etc/hosts`
edit, no CA install, no ngrok, no GitHub OAuth app.

> Clear Metro's cache on first run if you had the old OIDC deps installed:
> `cd apps/mobile && npx expo start -c`.

## Backend behavior

- `GET /health` is public (liveness).
- `POST /api/auth/login` is public (it's the thing that mints a session).
  - Validates `{ username, password }` by calling
    `${TINYAUTH_URL}/api/auth/traefik` with a Basic auth header.
  - On Tinyauth `200`, upserts the user by `username` (refreshing
    `email`/`name` from the `Remote-*` headers) and signs a 24h HS256 JWT.
  - On `401`/unreachable, returns `401` (fail closed).
- `GET /api/auth/me` is bearer-protected (returns the caller's user).
- Every `/api/recordings/*` route runs the `authHook` `preHandler`, which
  verifies the JWT (`iss`/`aud`/`exp`) and sets `req.user`; routes stay scoped
  by `req.user.id`.
- The previous `x-user-id` stub is gone from production. The state-machine
  test suite injects a fake `authHook` so it runs without Tinyauth; the real
  login/verify path is covered by `tests/auth.test.ts` (with `fetch` mocked to
  stand in for Tinyauth).

## Security notes / limitations

- **HTTP in local dev.** Credentials and JWTs travel over plain HTTP on
  `localhost`. For any non-local deployment, put Tinyauth and the backend
  behind HTTPS (a real reverse proxy / TLS terminator).
- **Tinyauth reachability.** Tinyauth is only reachable from the host backend
  (`:3001`); the mobile never contacts it. In production, keep Tinyauth
  internal to the backend's network.
- **Dummy passwords.** `pass1/2/3` are trivial — dev only. For real use, set
  strong `TINYAUTH_AUTH_USERS` hashes (or LDAP/OIDC) and don't ship them in
  the compose file.
- The backend-to-Tinyauth call is one `fetch` per login (not per request), so
  Tinyauth availability only affects login, not steady-state API traffic.

[Tinyauth]: https://github.com/tinyauthapp/tinyauth
