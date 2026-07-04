import { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Stub auth seam (per PRD §7 "Known Limitation" and Decisions §Auth stub depth)
// ---------------------------------------------------------------------------
// The MVP deliverable uses a per-interviewer stub via the `x-user-id` request
// header, resolved to a seeded dev user. The seam is real: every API route is
// scoped by the authenticated user's id. Swapping this for a real provider
// (magic link / OIDC) later only changes the lookup, not the route guards.

/** Dev users seeded on startup so per-user scoping is exercisable. */
const DEV_USERS = [
  { id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com" },
  { id: "00000000-0000-0000-0000-000000000002", email: "bob@example.com" },
];

/** Seed dev users (idempotent). Called once at app startup. */
export async function seedUsers(): Promise<void> {
  for (const u of DEV_USERS) {
    await db
      .insert(users)
      .values(u)
      .onConflictDoNothing({ target: users.id });
  }
}

/**
 * Fastify preHandler that resolves `req.user` from the `x-user-id` header.
 * Returns 401 if the header is missing or the user is unknown. The
 * `/health` endpoint is exempted so liveness checks don't need auth.
 */
export async function authHook(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (req.url === "/health") return;

  const raw = req.headers["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;

  if (!userId) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "x-user-id header is required",
      statusCode: 401,
    });
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Unknown user",
      statusCode: 401,
    });
  }

  req.user = rows[0];
}

// Fastify type augmentation: every authenticated request carries the user.
declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string };
  }
}