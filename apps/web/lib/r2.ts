/**
 * Cloudflare R2 storage helper — server-side only.
 *
 * All uploads use the native R2 bucket binding declared in wrangler.toml.
 * R2_PUBLIC_URL is the public base URL used for persisted image URLs.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface NativeR2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NativeR2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<NativeR2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

type R2Environment = {
  R2_BUCKET?: NativeR2Bucket;
};

function getPublicBase(): string {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error("[r2] Missing R2_PUBLIC_URL env var.");
  return base.replace(/\/+$/, "");
}

export function requireR2Bucket(env: R2Environment): NativeR2Bucket {
  if (!env.R2_BUCKET) {
    throw new Error(
      "[r2] Missing R2_BUCKET Cloudflare binding. Declare it in wrangler.toml."
    );
  }
  return env.R2_BUCKET;
}

function getBucket(): NativeR2Bucket {
  const { env } = getCloudflareContext();
  return requireR2Bucket(env as R2Environment);
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

export async function putR2Object(
  bucket: NativeR2Bucket,
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string
): Promise<void> {
  const bytes = body instanceof ArrayBuffer ? body : new Uint8Array(body);
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
  });
}

export async function getR2Object(
  bucket: NativeR2Bucket,
  key: string
): Promise<Buffer> {
  const object = await bucket.get(key);
  if (!object) throw new Error(`[r2] Object not found for key: ${key}`);
  return Buffer.from(await object.arrayBuffer());
}

/** Upload bytes to R2 and return their public URL. */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer,
  contentType: string
): Promise<string> {
  await putR2Object(getBucket(), key, body, contentType);
  return r2PublicUrl(key);
}

/** Download an R2 object by key and return it as a Buffer. */
export async function downloadFromR2(key: string): Promise<Buffer> {
  return getR2Object(getBucket(), key);
}

/** Delete an R2 object by key (R2 treats a missing key as a successful delete). */
export async function deleteFromR2(key: string): Promise<void> {
  await getBucket().delete(key);
}
