import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import {
  authHook,
  issueSessionToken,
  validateCredentials,
} from "../services/auth.js";

// ---------------------------------------------------------------------------
// Auth routes — Tinyauth-backed username/password login + session introspect.
//
//   POST /api/auth/login   { username, password } -> { token, user }
//   GET  /api/auth/me      -> { user }   (bearer-protected)
//
// `POST /api/auth/login` is exempted from the bearer hook by URL (see
// services/auth.ts); `GET /api/auth/me` is protected.
// ---------------------------------------------------------------------------

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Same preHandler as the recording routes; it exempts /api/auth/login by URL
  // and verifies the bearer token for everything else (including /me).
  app.addHook("preHandler", authHook);

  app.post(
    "/api/auth/login",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, unknown> | null;
      const username = String(body?.username ?? "").trim();
      const password = String(body?.password ?? "");

      if (!username || !password) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "username and password are required",
          statusCode: 400,
        });
      }

      const profile = await validateCredentials(username, password);
      if (!profile) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid username or password",
          statusCode: 401,
        });
      }

      // Upsert by the stable Tinyauth username; refresh email/name on each login.
      const [row] = await db
        .insert(users)
        .values({
          username: profile.username,
          email: profile.email,
          name: profile.name,
        })
        .onConflictDoUpdate({
          target: users.username,
          set: { email: profile.email, name: profile.name },
        })
        .returning();

      const token = await issueSessionToken({
        id: row.id,
        username: profile.username,
        email: profile.email,
      });

      return reply.status(200).send({
        data: {
          token,
          user: {
            id: row.id,
            username: row.username,
            email: row.email,
            name: row.name,
          },
        },
      });
    },
  );

  app.get("/api/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    // authHook already verified the token and set req.user.
    return reply.send({ data: { id: req.user.id, email: req.user.email } });
  });
}
