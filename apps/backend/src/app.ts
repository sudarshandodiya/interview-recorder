import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { getEnv } from "./config/env.js";
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

  // ---- Routes ----
  await app.register(recordingRoutes);

  // ---- Health check ----
  app.get("/health", async () => ({ status: "ok" }));

  return { app, env };
}
