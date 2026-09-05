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
  ListObjectsV2Command,
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

/** Returns the configured public R2 base without requiring a URL to parse. */
export function getR2PublicBase(): string {
  return getPublicBase();
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

export function getR2KeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const base = getPublicBase();
    if (!url.startsWith(base + "/")) return null;
    return url.slice(base.length + 1);
  } catch {
    return null;
  }
}

export function collectR2Keys(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const value of values) {
    const key = getR2KeyFromUrl(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

export function normalizeR2DeleteKeys(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const trimmed = value.trim();
    if (trimmed.includes("http://") || trimmed.includes("https://") || trimmed.includes("..") || trimmed.includes("*") || trimmed.startsWith("/")) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }

  return keys;
}

export async function deleteR2Keys(keys: Array<string | null | undefined>): Promise<{ deleted: string[]; failed: Array<{ key: string; error: string }> }> {
  const normalized = normalizeR2DeleteKeys(keys);
  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  for (const key of normalized) {
    try {
      await deleteFromR2(key);
      deleted.push(key);
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.message : "Unknown delete error" });
    }
  }

  return { deleted, failed };
}

export function shouldDeletePreviousR2Asset(
  previousUrl: string | null | undefined,
  nextUrl: string | null | undefined,
): boolean {
  if (!previousUrl || !nextUrl) return false;

  const previousKey = getR2KeyFromUrl(previousUrl);
  const nextKey = getR2KeyFromUrl(nextUrl);

  if (!previousKey || !nextKey) return false;
  return previousKey !== nextKey;
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

/** List object keys in the configured bucket, with optional pagination support. */
export async function listR2ObjectKeys(
  prefix?: string,
  continuationToken?: string,
): Promise<{ keys: string[]; nextContinuationToken?: string; isTruncated: boolean }> {
  const client = getClient();
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }),
  );

  const keys = (response.Contents ?? [])
    .map((entry) => entry.Key)
    .filter((key): key is string => Boolean(key));

  return {
    keys,
    nextContinuationToken: response.NextContinuationToken,
    isTruncated: response.IsTruncated === true,
  };
}

/** Delete an R2 object by key (best-effort — does not throw on 404). */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}

export type R2ReferenceLookup = {
  table: string;
  column: string;
  idColumn?: string;
  idValue?: string;
  getUrls?: (value: unknown) => string[];
};

function getReferenceUrls(lookup: R2ReferenceLookup, value: unknown): string[] {
  if (lookup.getUrls) return lookup.getUrls(value);
  return typeof value === "string" ? [value] : [];
}

export async function deleteOwnedR2AssetIfUnique(
  db: any,
  url: string | null | undefined,
  referenceLookups: R2ReferenceLookup[] = [],
): Promise<{ status: "deleted" | "shared" | "missing" | "skipped"; key: string | null; references: Array<{ table: string; column: string; id: string | null }> }> {
  const key = url ? getR2KeyFromUrl(url) : null;
  if (!key) {
    return { status: "missing", key: null, references: [] };
  }

  const references: Array<{ table: string; column: string; id: string | null }> = [];
  let lookupFailed = false;

  for (const lookup of referenceLookups) {
    let query = db.from(lookup.table).select(`id, ${lookup.column}`);
    if (lookup.idColumn && lookup.idValue) {
      query = query.eq(lookup.idColumn, lookup.idValue);
    }
    const { data, error } = await query;
    if (error) {
      console.error("[r2] reference lookup failed", { table: lookup.table, column: lookup.column, error });
      lookupFailed = true;
      continue;
    }
    for (const row of data ?? []) {
      const candidates = getReferenceUrls(lookup, row?.[lookup.column]);
      if (candidates.some((candidate) => getR2KeyFromUrl(candidate) === key)) {
        references.push({ table: lookup.table, column: lookup.column, id: typeof row?.id === "string" ? row.id : null });
      }
    }
  }

  if (lookupFailed) {
    return { status: "skipped", key, references };
  }

  if (references.length > 1) {
    return { status: "shared", key, references };
  }

  if (references.length === 0) {
    return { status: "skipped", key, references };
  }

  try {
    await deleteFromR2(key);
    return { status: "deleted", key, references };
  } catch (error) {
    console.error("[r2] delete failed", { key, error });
    return { status: "skipped", key, references };
  }
}

export async function deleteR2AssetIfUnreferenced(
  db: any,
  url: string | null | undefined,
  referenceLookups: R2ReferenceLookup[] = [],
): Promise<{ status: "deleted" | "referenced" | "missing" | "skipped"; key: string | null; references: Array<{ table: string; column: string; id: string | null }> }> {
  const key = url ? getR2KeyFromUrl(url) : null;
  if (!key) return { status: "missing", key: null, references: [] };

  const references: Array<{ table: string; column: string; id: string | null }> = [];
  for (const lookup of referenceLookups) {
    const { data, error } = await db.from(lookup.table).select(`id, ${lookup.column}`);
    if (error) {
      console.error("[r2] reference lookup failed", { table: lookup.table, column: lookup.column, error });
      return { status: "skipped", key, references };
    }
    for (const row of data ?? []) {
      const candidates = getReferenceUrls(lookup, row?.[lookup.column]);
      if (candidates.some((candidate) => getR2KeyFromUrl(candidate) === key)) {
        references.push({ table: lookup.table, column: lookup.column, id: typeof row?.id === "string" ? row.id : null });
      }
    }
  }

  if (references.length > 0) return { status: "referenced", key, references };
  try {
    await deleteFromR2(key);
    return { status: "deleted", key, references };
  } catch (error) {
    console.error("[r2] delete failed", { key, error });
    return { status: "skipped", key, references };
  }
}
