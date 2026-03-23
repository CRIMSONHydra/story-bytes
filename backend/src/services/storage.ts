import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { env } from '../config/env';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: env.awsRegion || 'us-east-1' });
  }
  return s3Client;
}

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function guessContentType(path: string): string {
  return MIME_MAP[extname(path).toLowerCase()] || 'application/octet-stream';
}

export const getFromS3 = async (key: string): Promise<Buffer | null> => {
  if (!env.s3Enabled) return null;
  try {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: env.awsBucket,
      Key: key,
    }));
    const bytes = await response.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
};

export const uploadToS3 = async (key: string, data: Buffer, contentType: string): Promise<string> => {
  await getS3Client().send(new PutObjectCommand({
    Bucket: env.awsBucket,
    Key: key,
    Body: data,
    ContentType: contentType,
  }));
  return `https://${env.awsBucket}.s3.${env.awsRegion}.amazonaws.com/${key}`;
};

export const resolveAssetData = async (
  storageUrl: string | null,
  localPaths: string[]
): Promise<{ data: Buffer; contentType: string } | null> => {
  // Try S3 if storage_url is set and S3 is enabled
  if (storageUrl && env.s3Enabled) {
    const key = storageUrl.replace(/^https?:\/\/[^/]+\//, '');
    const data = await getFromS3(key);
    if (data) return { data, contentType: guessContentType(key) };
  }

  // Fallback: try local filesystem
  for (const path of localPaths) {
    try {
      const data = await readFile(path);
      return { data, contentType: guessContentType(path) };
    } catch { /* continue */ }
  }

  return null;
};
