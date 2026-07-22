/**
 * Cloudflare R2 storage helper — server-side only.
 *
 * Thin wrapper around the AWS S3-compatible client that R2 exposes.
 * All image uploads in this app go through here instead of Supabase Storage.
 *
 * Required env vars (set in Vercel / .env.local):
 *   R2_ACCOUNT_ID          — Cloudflare account ID
 *   R2_ACCESS_KEY_ID       — R2 API token access key
 *   R2_SECRET_ACCESS_KEY   — R2 API token secret
 *   R2_BUCKET_NAME         — bucket name (e.g. "draft-images")
 *   R2_PUBLIC_URL          — public base URL for the bucket
 *                            (e.g. "https://pub-xxxx.r2.dev" or custom domain)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

function getClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "[r2] Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY env vars."
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("[r2] Missing R2_BUCKET_NAME env var.");
  return bucket;
}

function getPublicBase(): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("[r2] Missing R2_PUBLIC_URL env var.");
  return base.replace(/\/$/, "");
}

/** Returns the full public URL for a given R2 object key. */
export function r2PublicUrl(key: string): string {
  return `${getPublicBase()}/${key}`;
}

/**
 * Extracts the R2 object key from a public URL.
 * Returns null if the URL doesn't match this bucket's public base.
 */
export function parseR2Key(url: string): string | null {
  try {
    const base = getPublicBase();
    if (!url.startsWith(base + "/")) return null;
    return url.slice(base.length + 1);
  } catch {
    return null;
  }
}

/** Upload a Buffer to R2 and return its public URL. */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return r2PublicUrl(key);
}

/** Download an R2 object by key and return it as a Buffer. */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const client = getClient();
  const resp = await client.send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  if (!resp.Body) throw new Error(`[r2] Empty body downloading key: ${key}`);
  return Buffer.from(await resp.Body.transformToByteArray());
}

/** Delete an R2 object by key (best-effort — does not throw on 404). */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}
