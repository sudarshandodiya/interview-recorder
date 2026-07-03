import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default("us-east-1"),
  S3_BUCKET_NAME: z.string().default("interview-recordings"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().default("change-me"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
