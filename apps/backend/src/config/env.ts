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
  // Secret used to sign/verify session JWTs (HS256). Must be set explicitly;
  // the app will fail to start if JWT_SECRET is missing or set to a known
  // weak/default value. Generate a strong secret with:
  //   openssl rand -base64 32
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must be at least 16 characters")
    .refine(
      (v) =>
        ![
          "change-me",
          "change-me-in-production",
          "changeme",
          "secret",
          "password",
          "default",
          "jwt_secret",
        ].includes(v.toLowerCase().replace(/[^a-z0-9]/g, "")),
      {
        message:
          "JWT_SECRET is set to a known weak/default value — generate a strong random secret",
      },
    ),
  // Base URL of the Tinyauth credential store (HTTP is fine — we use
  // forward-auth/Basic auth, not the OIDC server). The backend validates
  // interviewer credentials by calling `${TINYAUTH_URL}/api/auth/traefik`.
  TINYAUTH_URL: z.string().url().default("http://localhost:3001"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}
