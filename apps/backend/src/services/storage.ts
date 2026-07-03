import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
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

/** Upload a buffer to S3 and return the object key */
export async function uploadToS3(
  key: string,
  body: Buffer,
  mimeType: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: mimeType,
    })
  );
}

/** Generate a pre-signed download URL (placeholder — real impl later) */
export async function getDownloadUrl(key: string): Promise<string> {
  // In a real implementation this would use getSignedUrl from @aws-sdk/s3-request-presigner
  // For now, return a placeholder using the same bucket/key
  return `${env.S3_ENDPOINT ?? "https://s3.amazonaws.com"}/${env.S3_BUCKET_NAME}/${key}`;
}

/** Ensure the S3 bucket exists (useful for LocalStack) */
export async function ensureBucket(): Promise<void> {
  const { CreateBucketCommand } = await import("@aws-sdk/client-s3");
  try {
    await s3Client.send(
      new CreateBucketCommand({ Bucket: env.S3_BUCKET_NAME })
    );
  } catch {
    // Bucket may already exist — that's fine for LocalStack
  }
}
