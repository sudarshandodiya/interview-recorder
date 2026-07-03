// ---- Core domain types shared between mobile app and backend ----

/** Possible sync statuses for a recording */
export type SyncStatus = "local" | "uploading" | "synced" | "failed";

/** Metadata tags associated with a recording session */
export interface RecordingMetadata {
  intervieweeName: string;
  tags?: string[];
  notes?: string;
}

/** A recording as managed by the backend / stored locally */
export interface Recording {
  id: string;
  userId: string;
  title: string;
  metadata: RecordingMetadata;
  durationMs: number;
  fileSizeBytes: number;
  mimeType: string;
  status: SyncStatus;
  s3Key: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** Payload sent when creating a new recording (without the file) */
export interface CreateRecordingPayload {
  title: string;
  metadata: RecordingMetadata;
  durationMs: number;
}

/** API envelope wrapper */
export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}
