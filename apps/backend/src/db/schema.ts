import {
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Users — interviewer profiles. Credentials live in Tinyauth (the dummy
// accounts seeded via TINYAUTH_AUTH_USERS); the backend upserts a row here on
// first login (keyed by the stable Tinyauth username) so recordings can be
// scoped per user. No password hashes are stored in the DB.
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Tinyauth `Remote-User` (the login username). Nullable so a pre-auth DB
  // survives a `drizzle-kit push`; first login sets it.
  username: varchar("username", { length: 255 }).unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  title: varchar("title", { length: 512 }).notNull(),

  intervieweeName: varchar("interviewee_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }),
  tags: text("tags").array().default([]),
  notes: text("notes"),

  durationMs: integer("duration_ms").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  mimeType: varchar("mime_type", { length: 100 })
    .notNull()
    .default("audio/mp4"),

  status: varchar("status", {
    length: 20,
    enum: ["local", "uploading", "synced", "failed"],
  })
    .notNull()
    .default("local"),

  s3Key: varchar("s3_key", { length: 1024 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
