import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../config/env.js";

const env = getEnv();

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle({ client: queryClient });
