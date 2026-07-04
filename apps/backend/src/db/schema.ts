import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Users (placeholder — full auth not implemented yet)
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
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
  mimeType: varchar("mime_type", { length: 100 }).notNull().default("audio/mp4"),

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
