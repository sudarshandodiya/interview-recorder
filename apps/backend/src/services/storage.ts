import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "../config/env.js";

const env = getEnv();

export const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  ...(env.S3_ENDPOINT
    ? {
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      }
    : {}),
});

/** Upload a buffer to S3. */
export async function uploadToS3(
  key: string,
  body: Buffer,
  mimeType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );
}

/**
 * Generate a short-lived pre-signed download URL for an S3 object.
 * Works against both LocalStack (S3_ENDPOINT set) and real S3.
 */
export async function getDownloadUrl(
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Delete an object from S3 (best-effort; missing objects are tolerated). */
export async function deleteFromS3(key: string): Promise<void> {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: key }),
    );
  } catch {
    // Object may already be absent — tolerate so DELETE is idempotent.
  }
}

/** Ensure the S3 bucket exists (useful for LocalStack). */
export async function ensureBucket(): Promise<void> {
  try {
    await s3Client.send(
      new CreateBucketCommand({ Bucket: env.S3_BUCKET_NAME }),
    );
  } catch {
    // Bucket may already exist — that's fine for LocalStack.
  }
}
