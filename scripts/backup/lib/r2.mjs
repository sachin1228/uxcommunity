/**
 * S3-compatible storage access for backups.
 *
 * Works against R2 and against any S3-compatible store (Backblaze B2, a second
 * Cloudflare account, MinIO) — the endpoint is configuration, not code. That
 * matters because R2 has no bucket replication and no object versioning: the
 * only way to survive "someone deleted the bucket" or "the account is
 * suspended" is a copy somewhere else, and the tooling must not assume the
 * destination is R2.
 *
 * RETRIES
 *   Uploads and listings are retried on transient failures (5xx, 429, network)
 *   with exponential backoff and jitter. 4xx responses other than 429 are not
 *   retried: a 403 from a dead credential will never succeed on a second try,
 *   and retrying it three times only delays the page. That distinction is the
 *   same one apps/web/lib/r2.ts draws for the media credential.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} = require("../../../node_modules/@aws-sdk/client-s3");

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

export function createClient({ endpoint, region, credentials }) {
  return new S3Client({
    region: region || "auto",
    endpoint,
    credentials,
    // The AWS SDK otherwise adds CRC32 checksums to every PutObject, which R2
    // accepts but some S3-compatible stores reject. Explicitly asking for
    // checksums only when required keeps the client portable.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function statusOf(error) {
  return error?.$metadata?.httpStatusCode ?? error?.statusCode ?? null;
}

/** Exported for tests: the classification that decides whether a retry helps. */
export function isRetryable(error) {
  const status = statusOf(error);
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  // No HTTP status at all means the request never completed (DNS, TLS, reset).
  if (status === null) return true;
  return false;
}

export function backoffDelay(attempt) {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  // Full jitter, so parallel workers do not retry in lockstep.
  return Math.floor(Math.random() * exponential);
}

export async function withRetry(operation, { attempts = MAX_ATTEMPTS, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = isRetryable(error) && attempt < attempts - 1;
      if (!canRetry) throw error;
      await wait(backoffDelay(attempt));
    }
  }
  throw lastError;
}

export async function putObject(client, { bucket, key, body, contentType }) {
  return withRetry(() =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    ),
  );
}

export async function getObjectBuffer(client, { bucket, key }) {
  const response = await withRetry(() =>
    client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
  );
  if (!response.Body) throw new Error(`object ${key} has no body`);
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function headObject(client, { bucket, key }) {
  try {
    return await withRetry(() => client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));
  } catch (error) {
    if (statusOf(error) === 404 || error?.name === "NotFound") return null;
    throw error;
  }
}

export async function deleteObject(client, { bucket, key }) {
  return withRetry(() => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })));
}

/**
 * Server-side copy. Encoding is per path segment: a key containing `#` or `+`
 * must survive, but the `/` separators must not be escaped or the copy source
 * names a single object that does not exist.
 */
export async function copyObject(client, { sourceBucket, sourceKey, destinationBucket, destinationKey }) {
  const encodedSource = sourceKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return withRetry(() =>
    client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        CopySource: `${sourceBucket}/${encodedSource}`,
      }),
    ),
  );
}

/**
 * Lists every object under a prefix, following continuation tokens.
 * Returns `{key, size, etag, lastModified}` — enough to decide whether a copy
 * is stale without downloading either side.
 */
export async function listAll(client, { bucket, prefix = "" }) {
  const objects = [];
  let token;
  do {
    const response = await withRetry(() =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      ),
    );
    for (const item of response.Contents ?? []) {
      if (!item?.Key) continue;
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        etag: (item.ETag ?? "").replace(/"/g, ""),
        lastModified: item.LastModified ? new Date(item.LastModified).toISOString() : null,
      });
    }
    token = response.NextContinuationToken;
  } while (token);
  return objects;
}
