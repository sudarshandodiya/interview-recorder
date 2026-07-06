import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { getEnv } from "./config/env.js";
import { authRoutes } from "./routes/auth.js";
import { recordingRoutes } from "./routes/recordings.js";

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({ logger: true });

  // ---- Plugins ----
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB
    },
  });
  await app.register(rateLimit, {
    global: false, // don't rate-limit everything; we apply per-route
  });

  // ---- Routes ----
  // Apply strict rate limiting to the login endpoint (5 attempts / minute per IP)
  // to mitigate brute-force attacks against interviewer credentials.
  await app.register(
    async (scoped) => {
      scoped.addHook("onRoute", (routeOptions) => {
        if (routeOptions.url === "/api/auth/login") {
          routeOptions.config = {
            ...routeOptions.config,
            rateLimit: {
              max: 5,
              timeWindow: "1 minute",
            },
          };
        }
      });
      await scoped.register(authRoutes);
    },
    { prefix: "" },
  );
  await app.register(recordingRoutes);

  // ---- Health check ----
  app.get("/health", async () => ({ status: "ok" }));

  return { app, env };
}
