import "dotenv/config";
import { buildApp } from "./app.js";

const { app, env } = await buildApp();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  console.log(`🚀 Backend running at http://${env.API_HOST}:${env.API_PORT}`);
  console.log(`   Health: http://${env.API_HOST}:${env.API_PORT}/health`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
