import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "../config/env.js";

// ---------------------------------------------------------------------------
// Tinyauth-backed username/password auth + session JWT.
// ---------------------------------------------------------------------------
// Interviewer credentials live in Tinyauth (the three dummy accounts seeded
// via `TINYAUTH_AUTH_USERS` in docker-compose.yml). The mobile app posts
// `{ username, password }` to `POST /api/auth/login`; the backend validates
// them by calling Tinyauth's forward-auth endpoint
// (`${TINYAUTH_URL}/api/auth/traefik`) with the request's Basic auth header.
// On 200 Tinyauth returns `Remote-User`/`Remote-Email`/`Remote-Name` headers;
// the backend upserts a user row (keyed by the Tinyauth username) and issues
// an HS256 session JWT (signed with `JWT_SECRET`). The mobile sends that JWT
// as `Authorization: Bearer <token>` on every subsequent call; `authHook`
// verifies it and sets `req.user`. Recording routes stay scoped by
// `req.user.id`.
//
// Why this shape: Tinyauth's OIDC *server* mode requires HTTPS (awkward for
// local dev — cert trust, especially under Expo Go). Its forward-auth/Basic-
// auth mode works over plain HTTP, so Tinyauth runs on http://localhost:3001
// with no Caddy, no hosts edits, no certs. The backend is the only caller of
// Tinyauth; the mobile never talks to Tinyauth directly.
//
// Tests inject a fake `authHook` (see tests/recordings.test.ts) so the state-
// machine suite runs without Tinyauth; the real login/verify path is covered
// in tests/auth.test.ts (with `fetch` mocked to stand in for Tinyauth).

// --- Tinyauth credential validation ---------------------------------------

export interface TinyauthProfile {
  username: string;
  email: string;
  name: string | null;
}

/**
 * Validate `(username, password)` against Tinyauth by calling its forward-auth
 * endpoint with a Basic auth header. Returns the user profile on success, or
 * `null` on bad credentials / a Tinyauth failure (treated as auth failure).
 */
export async function validateCredentials(
  username: string,
  password: string,
): Promise<TinyauthProfile | null> {
  const env = getEnv();
  const url = `${env.TINYAUTH_URL.replace(/\/$/, "")}/api/auth/traefik`;
  // Tinyauth synthesizes a pseudo email for password users from the APPURL
  // domain. `X-Forwarded-*` are required by the forward-auth endpoint; the
  // values are fixed since the backend is the sole caller and we use no
  // per-app ACLs (any valid credential passes).
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "X-Forwarded-Host": "interview-recorder.local",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Uri": "/",
      },
    });
  } catch (err) {
    // Tinyauth unreachable — fail closed (treat as invalid).
    console.warn("[auth] tinyauth unreachable:", (err as Error).message);
    return null;
  }
  if (res.status !== 200) return null;

  const remoteUser = res.headers.get("Remote-User");
  const remoteEmail = res.headers.get("Remote-Email");
  if (!remoteUser || !remoteEmail) return null;
  const remoteName = res.headers.get("Remote-Name");
  return {
    username: remoteUser,
    email: remoteEmail,
    name: remoteName || null,
  };
}

// --- Session JWT -----------------------------------------------------------

const ISSUER = "interview-recorder";
const AUDIENCE = "interview-recorder-mobile";
const SESSION_TTL = "24h";

/** Issue a session JWT for the given user. */
export async function issueSessionToken(user: {
  id: string;
  username: string;
  email: string;
}): Promise<string> {
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  return new SignJWT({
    sub: user.id,
    username: user.username,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

interface SessionClaims {
  sub: string;
  username: string;
  email: string;
}

/** Verify a session JWT and return its claims. Throws on invalid/expired. */
export async function verifySessionToken(
  token: string,
): Promise<SessionClaims> {
  const env = getEnv();
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const username = typeof payload.username === "string" ? payload.username : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!sub) throw new Error("token missing sub");
  return { sub, username, email };
}

// --- Fastify hook ----------------------------------------------------------

/**
 * Fastify preHandler that authenticates `req.user` from a bearer session JWT.
 * Returns 401 on missing/invalid tokens. `/health` and `/api/auth/login` are
 * exempted so liveness checks and login work without a session.
 */
export async function authHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (req.url === "/health" || req.url === "/api/auth/login") return;

  const auth = req.headers.authorization;
  const token =
    typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : null;

  if (!token) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authorization: Bearer <token> is required",
      statusCode: 401,
    });
  }

  let claims: SessionClaims;
  try {
    claims = await verifySessionToken(token);
  } catch (err) {
    req.log.warn(
      { err: (err as Error).message },
      "session token verification failed",
    );
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid or expired session token",
      statusCode: 401,
    });
  }

  req.user = { id: claims.sub, email: claims.email };
}

// Fastify type augmentation: every authenticated request carries the user.
declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string };
  }
}
