import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

// Set env vars before any module that calls getEnv() is imported.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.AWS_REGION = "us-east-1";
process.env.S3_BUCKET_NAME = "test-bucket";
process.env.S3_ENDPOINT = "http://localhost:4566";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.API_PORT = "3000";
process.env.API_HOST = "0.0.0.0";
process.env.JWT_SECRET = "test-secret";

// ---------------------------------------------------------------------------
// Shared mock state (hoisted before module mocks resolve).
// ---------------------------------------------------------------------------
const shared = vi.hoisted(() => ({
  recordings: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  uploadShouldFail: false,
  presignedUrl: "https://s3.local/test-key",
  deletedS3Keys: [] as string[],
}));

// ---------------------------------------------------------------------------
// Mock db (chainable thenable backed by in-memory arrays).
// ---------------------------------------------------------------------------
function buildColMap(table: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const jsKey of Object.keys(table)) {
    const col = (table as Record<string, unknown>)[jsKey];
    if (col && typeof col === "object" && "name" in col) {
      map[(col as { name: string }).name] = jsKey;
    }
  }
  return map;
}

function evalCond(
  cond: unknown,
  colMap: Record<string, string>,
  row: Record<string, unknown>
): boolean {
  if (!cond) return true;
  const c = cond as { kind?: string; name?: string; val?: unknown; conds?: unknown[] };
  if (c.kind === "eq") {
    const jsKey = colMap[c.name!];
    return row[jsKey] === c.val;
  }
  if (c.kind === "and") {
    return (c.conds ?? []).every((sub) => evalCond(sub, colMap, row));
  }
  return true;
}

function makeSelectChain(table: Record<string, unknown>, store: Record<string, unknown>[]) {
  const colMap = buildColMap(table);
  const state: {
    conds: unknown[];
    orderDesc?: string;
    limitN?: number;
  } = { conds: [] };

  const chain = {
    from: () => chain,
    where: (cond: unknown) => {
      state.conds.push(cond);
      return chain;
    },
    orderBy: (cond: unknown) => {
      const c = cond as { kind?: string; name?: string };
      if (c.kind === "desc") state.orderDesc = colMap[c.name!];
      return chain;
    },
    limit: (n: number) => {
      state.limitN = n;
      return chain;
    },
    then: (
      resolve: (rows: Record<string, unknown>[]) => unknown,
      reject?: (e: unknown) => unknown
    ) => {
      try {
        let rows = store.filter((r) =>
          state.conds.every((cond) => evalCond(cond, colMap, r))
        );
        if (state.orderDesc) {
          rows = [...rows].sort((a, b) => {
            const av = a[state.orderDesc!] as string | number;
            const bv = b[state.orderDesc!] as string | number;
            return bv > av ? 1 : bv < av ? -1 : 0;
          });
        }
        if (state.limitN !== undefined) rows = rows.slice(0, state.limitN);
        return Promise.resolve(rows).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(undefined, reject);
      }
    },
  };
  return chain;
}

function makeInsertChain(
  table: Record<string, unknown>,
  store: Record<string, unknown>[],
  values: Record<string, unknown>
) {
  const colMap = buildColMap(table);
  const jsKeys = Object.values(colMap); // all JS property names for this table
  // Start from null for every column (mirrors SQL NULL for unset columns),
  // then overlay provided values, then fill generated defaults.
  const fullValues: Record<string, unknown> = {};
  for (const jsKey of jsKeys) fullValues[jsKey] = null;
  Object.assign(fullValues, values);
  if (!fullValues.id) fullValues.id = crypto.randomUUID();
  if (!fullValues.createdAt) fullValues.createdAt = new Date().toISOString();
  if (!fullValues.updatedAt) fullValues.updatedAt = new Date().toISOString();

  const state: { conflictTarget?: string; wantReturn: boolean } = {
    wantReturn: false,
  };
  const chain = {
    values: () => chain,
    onConflictDoNothing: (opts?: { target?: { name: string } }) => {
      if (opts?.target) state.conflictTarget = colMap[opts.target.name];
      return chain;
    },
    returning: () => {
      state.wantReturn = true;
      return chain;
    },
    then: (
      resolve: (rows: Record<string, unknown>[]) => unknown,
      reject?: (e: unknown) => unknown
    ) => {
      try {
        if (state.conflictTarget) {
          const exists = store.some(
            (r) => r[state.conflictTarget!] === fullValues[state.conflictTarget!]
          );
          if (exists) return Promise.resolve([]).then(resolve, reject);
        }
        store.push({ ...fullValues });
        const row = { ...fullValues };
        return Promise.resolve(state.wantReturn ? [row] : []).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(undefined, reject);
      }
    },
  };
  return chain;
}

function makeUpdateChain(
  table: Record<string, unknown>,
  store: Record<string, unknown>[],
  setValues: Record<string, unknown>
) {
  const colMap = buildColMap(table);
  const state: { conds: unknown[] } = { conds: [] };
  const chain = {
    set: () => chain,
    where: (cond: unknown) => {
      state.conds.push(cond);
      return chain;
    },
    then: (
      resolve: (rows: unknown[]) => unknown,
      reject?: (e: unknown) => unknown
    ) => {
      try {
        for (const row of store) {
          if (state.conds.every((c) => evalCond(c, colMap, row))) {
            Object.assign(row, setValues);
          }
        }
        return Promise.resolve([]).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(undefined, reject);
      }
    },
  };
  return chain;
}

function makeDeleteChain(
  table: Record<string, unknown>,
  store: Record<string, unknown>[],
  conds: unknown[]
) {
  const colMap = buildColMap(table);
  const chain = {
    where: (cond: unknown) => {
      conds.push(cond);
      return chain;
    },
    then: (
      resolve: (rows: Record<string, unknown>[]) => unknown,
      reject?: (e: unknown) => unknown
    ) => {
      try {
        const toDelete = store.filter((r) =>
          conds.every((c) => evalCond(c, colMap, r))
        );
        for (const row of toDelete) {
          const idx = store.indexOf(row);
          if (idx >= 0) store.splice(idx, 1);
        }
        return Promise.resolve(toDelete).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(undefined, reject);
      }
    },
  };
  return chain;
}

// Route users-table vs recordings-table by checking for an `email` column.
function storeFor(table: Record<string, unknown>): Record<string, unknown>[] {
  const isUsers = Object.prototype.hasOwnProperty.call(table, "email");
  return isUsers ? shared.users : shared.recordings;
}

vi.mock("../src/db/index.js", () => ({
  db: {
    select: () => ({
      from: (table: Record<string, unknown>) =>
        makeSelectChain(table, storeFor(table)),
    }),
    insert: (table: Record<string, unknown>) => ({
      values: (v: Record<string, unknown>) =>
        makeInsertChain(table, storeFor(table), v),
    }),
    update: (table: Record<string, unknown>) => ({
      set: (s: Record<string, unknown>) =>
        makeUpdateChain(table, storeFor(table), s),
    }),
    delete: (table: Record<string, unknown>) =>
      makeDeleteChain(table, storeFor(table), []),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ kind: "eq", name: col.name, val }),
  and: (...conds: unknown[]) => ({ kind: "and", conds }),
  desc: (col: { name: string }) => ({ kind: "desc", name: col.name }),
}));

vi.mock("../src/services/storage.js", () => ({
  ensureBucket: vi.fn(async () => {}),
  getDownloadUrl: vi.fn(async () => shared.presignedUrl),
  deleteFromS3: vi.fn(async (key: string) => {
    shared.deletedS3Keys.push(key);
  }),
  uploadToS3: vi.fn(async () => {}),
}));

vi.mock("../src/services/sync.js", () => ({
  uploadAudioRecording: vi.fn(
    async (
      recordingId: string,
      _userId: string,
      _buffer: Buffer,
      _mimeType: string,
      _filename: string,
      revertTo: "local" | "failed"
    ) => {
      if (shared.uploadShouldFail) {
        // Simulate transient S3 failure: revert status then throw.
        const rec = shared.recordings.find((r) => r.id === recordingId);
        if (rec) rec.status = revertTo;
        throw new Error("S3 transient failure");
      }
      // Success: transition to synced (the real impl does this, but since
      // we're mocking the whole function, simulate the final state).
      const rec = shared.recordings.find((r) => r.id === recordingId);
      if (rec) {
        rec.status = "synced";
        rec.s3Key = `recordings/${rec.userId}/${recordingId}/recording.m4a`;
      }
    }
  ),
}));

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
const ALICE = "00000000-0000-0000-0000-000000000001";
const BOB = "00000000-0000-0000-0000-000000000002";

let app: FastifyInstance;

async function buildTestApp(): Promise<FastifyInstance> {
  // Import after mocks are registered.
  const { buildApp } = await import("../src/app.js");
  const { app } = await buildApp();
  return app;
}

function makeRecording(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    userId: ALICE,
    title: "Interview with Jane Doe",
    intervieweeName: "Jane Doe",
    role: null,
    tags: [],
    notes: null,
    durationMs: 60000,
    fileSizeBytes: 0,
    mimeType: "audio/mp4",
    status: "local",
    s3Key: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal multipart/form-data body for a single file field. */
function multipartBody(
  filename: string,
  content: string,
  mimeType = "audio/mp4"
): { body: string; contentType: string } {
  const boundary = "----TestBoundary12345";
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeEach(async () => {
  shared.recordings = [];
  shared.users = [];
  shared.uploadShouldFail = false;
  shared.deletedS3Keys = [];

  // Seed dev users directly into the mock store (what seedUsers would do).
  shared.users.push(
    { id: ALICE, email: "alice@example.com", createdAt: new Date().toISOString() },
    { id: BOB, email: "bob@example.com", createdAt: new Date().toISOString() }
  );

  app = await buildTestApp();
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Auth seam (T-005)", () => {
  it("rejects requests without x-user-id header (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/recordings" });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/x-user-id/);
  });

  it("rejects requests with an unknown user id (401)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/recordings",
      headers: { "x-user-id": "unknown-uuid" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("allows /health without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("Per-user scoping (T-005)", () => {
  it("lists only the requesting user's recordings", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, intervieweeName: "Alice's candidate" }),
      makeRecording({ id: "r2", userId: BOB, intervieweeName: "Bob's candidate" })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/recordings",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("r1");
  });

  it("returns 404 when fetching another user's recording (no existence leak)", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: BOB })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/recordings/r1",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when deleting another user's recording", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: BOB, s3Key: "recordings/bob/r1/rec.m4a", status: "synced" })
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/recordings/r1",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(404);
    // Recording still exists (not deleted)
    expect(shared.recordings.find((r) => r.id === "r1")).toBeDefined();
  });
});

describe("Two-step upload: create (T-006)", () => {
  it("creates a metadata-only recording with status local (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/recordings",
      headers: { "x-user-id": ALICE, "content-type": "application/json" },
      payload: {
        intervieweeName: "Jane Doe",
        role: "Senior Backend Engineer",
        tags: ["system-design"],
        notes: "Strong candidate",
        durationMs: 1800000,
      },
    });

    expect(res.statusCode).toBe(201);
    const rec = res.json().data;
    expect(rec.status).toBe("local");
    expect(rec.intervieweeName).toBe("Jane Doe");
    expect(rec.role).toBe("Senior Backend Engineer");
    expect(rec.userId).toBe(ALICE);
    expect(rec.title).toBe("Interview with Jane Doe");
    expect(rec.s3Key).toBeNull();
  });

  it("rejects create without intervieweeName (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/recordings",
      headers: { "x-user-id": ALICE, "content-type": "application/json" },
      payload: { durationMs: 1000 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/intervieweeName/);
  });

  it("rejects create with negative durationMs (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/recordings",
      headers: { "x-user-id": ALICE, "content-type": "application/json" },
      payload: { intervieweeName: "Jane", durationMs: -100 },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("Two-step upload: audio upload (T-006)", () => {
  it("transitions local -> synced on successful audio upload", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "local" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE_AUDIO");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("synced");
    expect(res.json().data.s3Key).toContain("recordings/");
  });

  it("returns 503 and reverts to local on transient S3 failure", async () => {
    shared.uploadShouldFail = true;
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "local" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(503);
    expect(shared.recordings.find((r) => r.id === "r1")!.status).toBe("local");
  });

  it("returns 409 when uploading audio to an already-synced recording", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "synced", s3Key: "key" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(409);
  });

  it("returns 400 when uploading audio to a failed recording (must use /retry)", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "failed" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when uploading audio to another user's recording", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: BOB, status: "local" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("Retry endpoint (T-006)", () => {
  it("returns 400 when retrying a non-failed recording", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "synced", s3Key: "key" })
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/retry",
      headers: { "x-user-id": ALICE, "content-type": "multipart/form-data; boundary=x" },
      payload: "--x--\r\n",
    });

    expect(res.statusCode).toBe(400);
  });

  it("transitions failed -> synced on successful retry", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "failed" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/retry",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("synced");
  });

  it("reverts to failed on transient retry failure", async () => {
    shared.uploadShouldFail = true;
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "failed" })
    );
    const { body, contentType } = multipartBody("rec.m4a", "FAKE");

    const res = await app.inject({
      method: "POST",
      url: "/api/recordings/r1/retry",
      headers: { "x-user-id": ALICE, "content-type": contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(503);
    expect(shared.recordings.find((r) => r.id === "r1")!.status).toBe("failed");
  });
});

describe("Audio download endpoint (T-007)", () => {
  it("returns a pre-signed URL for a synced recording (owner-only)", async () => {
    shared.recordings.push(
      makeRecording({
        id: "r1",
        userId: ALICE,
        status: "synced",
        s3Key: "recordings/alice/r1/rec.m4a",
        mimeType: "audio/mp4",
      })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.url).toBe(shared.presignedUrl);
    expect(res.json().data.mimeType).toBe("audio/mp4");
  });

  it("returns 404 for a non-owner", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: BOB, status: "synced", s3Key: "key" })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when audio is not yet synced", async () => {
    shared.recordings.push(
      makeRecording({ id: "r1", userId: ALICE, status: "local" })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/recordings/r1/audio",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe("Delete endpoint (T-005)", () => {
  it("deletes the recording and its S3 object (owner-only)", async () => {
    shared.recordings.push(
      makeRecording({
        id: "r1",
        userId: ALICE,
        status: "synced",
        s3Key: "recordings/alice/r1/rec.m4a",
      })
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/recordings/r1",
      headers: { "x-user-id": ALICE },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.deleted).toBe(true);
    expect(shared.recordings.find((r) => r.id === "r1")).toBeUndefined();
    expect(shared.deletedS3Keys).toContain("recordings/alice/r1/rec.m4a");
  });
});

describe("Error classification (shared types)", () => {
  it("classifies network errors and 5xx as transient", async () => {
    const { classifyError } = await import("@interview-recorder/shared");
    expect(classifyError({ networkError: true })).toBe("transient");
    expect(classifyError({ status: 503 })).toBe("transient");
    expect(classifyError({ status: 500 })).toBe("transient");
    expect(classifyError({ status: undefined })).toBe("transient");
  });

  it("classifies 4xx as non-transient", async () => {
    const { classifyError } = await import("@interview-recorder/shared");
    expect(classifyError({ status: 400 })).toBe("non-transient");
    expect(classifyError({ status: 401 })).toBe("non-transient");
    expect(classifyError({ status: 404 })).toBe("non-transient");
  });

  it("exposes the PRD backoff schedule and max attempts", async () => {
    const { BACKOFF_MS, MAX_ATTEMPTS } = await import("@interview-recorder/shared");
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(MAX_ATTEMPTS).toBe(5);
  });
});