import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Real auth path (services/auth.ts + routes/auth.ts)
// ---------------------------------------------------------------------------
// The state-machine suite (recordings.test.ts) injects a fake `authHook`. This
// file exercises the production Tinyauth-backed login + JWT path: `fetch` is
// mocked to stand in for Tinyauth's forward-auth endpoint, the db upsert is
// mocked, and jose signs/verifies real HS256 JWTs.

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.AWS_REGION = "us-east-1";
process.env.S3_BUCKET_NAME = "test-bucket";
process.env.S3_ENDPOINT = "http://localhost:4566";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.API_PORT = "3000";
process.env.API_HOST = "0.0.0.0";
process.env.JWT_SECRET = "test-secret-at-least-8-chars";
process.env.TINYAUTH_URL = "http://localhost:3001";

// --- Mock db: insert().values().onConflictDoUpdate().returning() -----------
const upserted: { values: Record<string, unknown> }[] = [];
const upsertReturn: Record<string, unknown> = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "interviewer1",
  email: "interviewer1@interview-recorder.local",
  name: "Interviewer1",
};
vi.mock("../src/db/index.js", () => {
  const chain = {
    values: vi.fn((v: unknown) => {
      upserted.push({ values: v as Record<string, unknown> });
      return chain;
    }),
    onConflictDoUpdate: vi.fn(() => chain),
    onConflictDoNothing: vi.fn(() => chain),
    returning: vi.fn(async () => [upsertReturn]),
  };
  return { db: { insert: vi.fn(() => chain) } };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ name: col.name, val }),
  and: (...conds: unknown[]) => ({ kind: "and", conds }),
  desc: (col: { name: string }) => ({ kind: "desc", name: col.name }),
}));

// storage/sync mocks so recordingRoutes' ensureBucket() doesn't hit S3.
vi.mock("../src/services/storage.js", () => ({
  ensureBucket: vi.fn(async () => {}),
  getDownloadUrl: vi.fn(async () => "https://s3.local/test"),
  deleteFromS3: vi.fn(async () => {}),
  uploadToS3: vi.fn(async () => {}),
}));
vi.mock("../src/services/sync.js", () => ({
  uploadAudioRecording: vi.fn(async () => {}),
}));

// --- Mock fetch (Tinyauth forward-auth) ------------------------------------
// Returns 200 + Remote-* headers for interviewer1/pass1, else 401.
const fetchSpy = vi
  .spyOn(globalThis, "fetch")
  .mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    const auth = headers.get("Authorization") ?? "";
    const creds = auth.startsWith("Basic ")
      ? Buffer.from(auth.slice(6), "base64").toString()
      : "";
    if (url.includes("/api/auth/traefik")) {
      if (creds === "interviewer1:pass1") {
        return new Response("ok", {
          status: 200,
          headers: {
            "Remote-User": "interviewer1",
            "Remote-Email": "interviewer1@interview-recorder.local",
            "Remote-Name": "Interviewer1",
          },
        });
      }
      return new Response("no", { status: 401 });
    }
    return new Response("", { status: 404 });
  });

let app: FastifyInstance;

beforeEach(async () => {
  upserted.length = 0;
  const { buildApp } = await import("../src/app.js");
  const built = await buildApp();
  app = built.app;
});

describe("session token (jose)", () => {
  it("issues and verifies a session token", async () => {
    const { issueSessionToken, verifySessionToken } = await import(
      "../src/services/auth.js"
    );
    const token = await issueSessionToken({
      id: "u-1",
      username: "interviewer1",
      email: "interviewer1@interview-recorder.local",
    });
    const claims = await verifySessionToken(token);
    expect(claims.sub).toBe("u-1");
    expect(claims.username).toBe("interviewer1");
  });

  it("rejects a tampered token", async () => {
    const { verifySessionToken } = await import("../src/services/auth.js");
    await expect(verifySessionToken("not.a.real.token")).rejects.toThrow();
  });
});

describe("validateCredentials (Tinyauth forward-auth)", () => {
  it("returns the profile on valid credentials", async () => {
    const { validateCredentials } = await import("../src/services/auth.js");
    const p = await validateCredentials("interviewer1", "pass1");
    expect(p).toEqual({
      username: "interviewer1",
      email: "interviewer1@interview-recorder.local",
      name: "Interviewer1",
    });
    // Sent a Basic auth header to the forward-auth endpoint.
    const sentAuth = new Headers(
      (fetchSpy.mock.calls.at(-1)?.[1] as RequestInit | undefined)?.headers,
    ).get("Authorization");
    expect(sentAuth).toMatch(/^Basic /);
  });

  it("returns null on bad credentials", async () => {
    const { validateCredentials } = await import("../src/services/auth.js");
    const p = await validateCredentials("interviewer1", "WRONG");
    expect(p).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  it("returns a token for valid credentials and upserts the user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "interviewer1", password: "pass1" }),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(typeof data.token).toBe("string");
    expect(data.user.username).toBe("interviewer1");
    expect(upserted[0]?.values).toMatchObject({
      username: "interviewer1",
      email: "interviewer1@interview-recorder.local",
      name: "Interviewer1",
    });
  });

  it("rejects wrong credentials (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "interviewer1", password: "WRONG" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("validates missing fields (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "x" }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("rejects without a token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user with a valid token", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ username: "interviewer1", password: "pass1" }),
    });
    const token = login.json().data.token;

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe("interviewer1@interview-recorder.local");
  });
});
