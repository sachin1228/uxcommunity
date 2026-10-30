/**
 * Private R2 storage — server-side only.
 *
 * Resumes, verification work samples and DM images are personal data, so they
 * live in a bucket that has no public URL and no public custom domain. The
 * browser never receives a permanent object URL:
 *
 *   * the database stores an object key (`resumes/<user>/…`,
 *     `verification/<user>/…`, `dm/<conversation>/…`);
 *   * the app returns an authorization-gated proxy path, or a short-lived
 *     presigned GET URL generated only after the caller's access was checked;
 *   * every private object is written with `Cache-Control: private, no-store`,
 *     so neither a CDN nor a shared cache keeps a copy.
 *
 * This module deliberately has no `server-only` import: the pure key/path
 * helpers and the presigner are unit-tested under `tsx --test`, same as
 * `lib/r2.ts`.
 */

import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, getR2KeyFromUrl, sendR2Command } from "@/lib/r2";

export const PRIVATE_BUCKET_ENV = "R2_PRIVATE_BUCKET_NAME";

/** A private write was attempted while the private bucket is not configured. */
export class PrivateStorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Private storage is not configured. Set R2_PRIVATE_BUCKET_NAME to an R2 bucket " +
        "with public access disabled (no r2.dev domain, no custom domain), grant the media " +
        "API token Object Read & Write on it, and redeploy.",
    );
    this.name = "PrivateStorageNotConfiguredError";
  }
}

export function isPrivateStorageConfigured(): boolean {
  return Boolean(process.env[PRIVATE_BUCKET_ENV]?.trim());
}

function getPrivateBucket(): string {
  const bucket = process.env[PRIVATE_BUCKET_ENV]?.trim();
  if (!bucket) throw new PrivateStorageNotConfiguredError();
  return bucket;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** True when a string is a single, traversal-free path segment. */
export function isSafeFileSegment(value: string): boolean {
  return SAFE_FILE_RE.test(value) && !value.includes("..");
}

/**
 * True when an object key belongs to the private namespace.
 *
 * Keys are generated server-side, so this is a defence-in-depth gate for the
 * values that come back out of the database, not a parser for client input.
 */
export function isPrivateObjectKey(key: string | null | undefined): key is string {
  if (!key || typeof key !== "string") return false;
  if (key.length > 512) return false;
  if (key.startsWith("/") || key.includes("..") || key.includes("*")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return false;
  return (
    key.startsWith("resumes/") ||
    key.startsWith("verification/") ||
    key.startsWith("dm/")
  );
}

/** The key a legacy public URL points at, or null when it is not ours. */
export function legacyPrivateKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const key = getR2KeyFromUrl(url);
    return key && isPrivateObjectKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function privateResumeKey(userId: string, extension: string): string {
  return `resumes/${userId}/${randomUUID()}.${extension}`;
}

export function privateSavedResumeKey(userId: string, extension: string): string {
  return `resumes/${userId}/saved/${randomUUID()}.${extension}`;
}

export function privateVerificationKey(userId: string, extension: string): string {
  return `verification/${userId}/${randomUUID()}.${extension}`;
}

export function privateDmKey(conversationId: string, extension: string): string {
  return `dm/${conversationId}/${randomUUID()}.${extension}`;
}

/** True when a verification key sits under the member's own prefix. */
export function isOwnVerificationKey(key: string, userId: string): boolean {
  return (
    isPrivateObjectKey(key) &&
    key.startsWith(`verification/${userId}/`) &&
    isSafeFileSegment(key.slice(`verification/${userId}/`.length))
  );
}

export function resumeApplicationPath(applicationId: string): string {
  return `/api/private/resume/application/${applicationId}`;
}

export function savedResumePath(resumeId: string): string {
  return `/api/private/resume/saved/${resumeId}`;
}

/** The stable, authorization-gated path for one DM image. */
export function dmAssetPath(conversationId: string, file: string): string {
  return `/api/private/dm/${conversationId}/${file}`;
}

/** The proxy path for a stored `dm/<conversation>/<file>` key. */
export function dmKeyToAssetPath(key: string | null | undefined): string | null {
  if (!key || !key.startsWith("dm/")) return null;
  const [, conversationId, file, ...rest] = key.split("/");
  if (rest.length || !conversationId || !UUID_RE.test(conversationId) || !file) return null;
  if (!isSafeFileSegment(file)) return null;
  return dmAssetPath(conversationId, file);
}

/** Resolve a proxy path back to its object key, or null when malformed. */
export function dmPathToKey(conversationId: string, file: string): string | null {
  if (!UUID_RE.test(conversationId) || !isSafeFileSegment(file)) return null;
  return `dm/${conversationId}/${file}`;
}

/**
 * The key a DM send's `image_url` refers to, when it is a private asset.
 *
 * Accepts the stable proxy path and the legacy public bucket URL. GIPHY and
 * other external images deliberately return null and stay URL-backed.
 */
export function dmKeyFromImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/api/private/dm/")) {
    const [, , , , conversationId, file] = value.split("/");
    if (!conversationId || !file) return null;
    return dmPathToKey(conversationId, file);
  }
  return legacyPrivateKeyFromUrl(value);
}

/** Store a private object and return its key. No public URL is produced. */
export async function uploadPrivateToR2(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (!isPrivateObjectKey(key)) throw new Error(`[r2-private] Refusing non-private key: ${key}`);
  const client = getR2Client();
  await sendR2Command(() =>
    client.send(
      new PutObjectCommand({
        Bucket: getPrivateBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "private, no-store",
      }),
    ),
  );
  return key;
}

export interface PrivateListedObject {
  key: string;
  size: number;
  lastModified: string | null;
}

/** List private objects (the admin orphan audit and the migration script). */
export async function listPrivateObjectKeys(
  continuationToken?: string,
): Promise<{
  objects: PrivateListedObject[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}> {
  const client = getR2Client();
  const response = await sendR2Command(() =>
    client.send(
      new ListObjectsV2Command({
        Bucket: getPrivateBucket(),
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    ),
  );
  const objects = (response.Contents ?? [])
    .filter((entry): entry is NonNullable<typeof entry> & { Key: string } => Boolean(entry?.Key))
    .map((entry) => ({
      key: entry.Key,
      size: entry.Size ?? 0,
      lastModified: entry.LastModified ? new Date(entry.LastModified).toISOString() : null,
    }));
  return {
    objects,
    nextContinuationToken: response.NextContinuationToken,
    isTruncated: response.IsTruncated === true,
  };
}

export interface SignPrivateGetOptions {
  /** Seconds until the URL stops working. Keep it short (default 5 min). */
  expiresInSeconds?: number;
  /** When set, R2 sends `Content-Disposition: attachment; filename=…`. */
  downloadFileName?: string;
}

/** Presign a short-lived GET for a private object. Auth must be checked first. */
export async function signPrivateGet(
  key: string,
  options: SignPrivateGetOptions = {},
): Promise<string> {
  if (!isPrivateObjectKey(key)) throw new Error(`[r2-private] Refusing non-private key: ${key}`);
  const expiresIn = Math.min(Math.max(options.expiresInSeconds ?? 300, 1), 3600);
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: getPrivateBucket(),
    Key: key,
    ...(options.downloadFileName
      ? {
          ResponseContentDisposition: `attachment; filename="${options.downloadFileName.replace(/["\\]/g, "_")}"`,
        }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn });
}

/** Delete a private object. Missing keys are a no-op. */
export async function deletePrivateObject(key: string): Promise<void> {
  if (!isPrivateObjectKey(key)) return;
  const client = getR2Client();
  await sendR2Command(() =>
    client.send(new DeleteObjectCommand({ Bucket: getPrivateBucket(), Key: key })),
  );
}
