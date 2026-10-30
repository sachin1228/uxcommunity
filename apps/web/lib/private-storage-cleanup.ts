/**
 * Lifecycle cleanup for private R2 objects.
 *
 * Private files are outside the public-bucket orphan audit, so every delete
 * path that can orphan one reclaims it here:
 *
 *   * a saved resume is removed when no `member_resumes` row and no
 *     `job_applications` row still points at its key (the same file can be
 *     attached to several applications);
 *   * verification samples are removed once no request references the key;
 *   * DM images are removed once no message (and no moderation report's
 *     evidence snapshot) references them.
 *
 * Failures are logged and swallowed: the database row is already gone, and the
 * migration script's orphan scan can reclaim anything left behind.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deletePrivateObject,
  dmKeyToAssetPath,
  isPrivateObjectKey,
  legacyPrivateKeyFromUrl,
} from "@/lib/r2-private";

type Db = SupabaseClient;

function uniqueKeys(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    if (!value || !isPrivateObjectKey(value) || seen.has(value)) continue;
    seen.add(value);
    keys.push(value);
  }
  return keys;
}

/** Object keys stored in a URL column, for rows written before the migration. */
function legacyKeysFromUrls(values: Array<string | null | undefined>): string[] {
  return uniqueKeys(values.map((value) => legacyPrivateKeyFromUrl(value)));
}

async function countReferences(
  db: Db,
  table: string,
  column: string,
  key: string,
): Promise<number | null> {
  const { count, error } = await (db as unknown as SupabaseClient)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, key);
  if (error) {
    console.error("[private-storage] reference lookup failed", { table, column, error });
    return null;
  }
  return count ?? 0;
}

/**
 * Delete the given resume keys unless a saved resume or an application still
 * references them. A failed lookup keeps the object (fail closed).
 */
export async function deletePrivateResumeKeysIfUnreferenced(
  db: Db,
  keys: Array<string | null | undefined>,
): Promise<{ deleted: string[]; kept: string[] }> {
  const deleted: string[] = [];
  const kept: string[] = [];

  for (const key of uniqueKeys(keys)) {
    const [saved, applied] = await Promise.all([
      countReferences(db, "member_resumes", "storage_key", key),
      countReferences(db, "job_applications", "resume_key", key),
    ]);
    if (saved === null || applied === null || saved + applied > 0) {
      kept.push(key);
      continue;
    }
    try {
      await deletePrivateObject(key);
      deleted.push(key);
    } catch (error) {
      console.error("[private-storage] resume delete failed", { key, error });
      kept.push(key);
    }
  }

  return { deleted, kept };
}

/** The private résumé keys attached to one job's applications. */
export async function collectJobResumeKeys(db: Db, jobId: string): Promise<string[]> {
  const { data, error } = await (db as unknown as SupabaseClient)
    .from("job_applications")
    .select("resume_key")
    .eq("job_id", jobId);
  if (error) {
    console.error("[private-storage] job resume lookup failed", { jobId, error });
    return [];
  }
  return uniqueKeys((data ?? []).map((row) => row.resume_key));
}

/** Delete verification samples once the owning request row is gone. */
export async function deletePrivateVerificationKeys(
  db: Db,
  keys: Array<string | null | undefined>,
): Promise<{ deleted: string[]; kept: string[] }> {
  const deleted: string[] = [];
  const kept: string[] = [];

  for (const key of uniqueKeys(keys)) {
    const { count, error } = await (db as unknown as SupabaseClient)
      .from("account_verification_requests")
      .select("id", { count: "exact", head: true })
      .contains("work_sample_keys", [key]);
    if (error || (count ?? 0) > 0) {
      if (error) console.error("[private-storage] verification lookup failed", { key, error });
      kept.push(key);
      continue;
    }
    try {
      await deletePrivateObject(key);
      deleted.push(key);
    } catch (error) {
      console.error("[private-storage] verification delete failed", { key, error });
      kept.push(key);
    }
  }

  return { deleted, kept };
}

/**
 * Delete DM images unless a message still references the key or a moderation
 * report's evidence snapshot keeps the asset path.
 */
export async function deletePrivateDmKeys(
  db: Db,
  keys: Array<string | null | undefined>,
): Promise<{ deleted: string[]; kept: string[] }> {
  const deleted: string[] = [];
  const kept: string[] = [];

  const candidates = uniqueKeys(keys);
  if (!candidates.length) return { deleted, kept };

  const { data: reports, error: reportError } = await (db as unknown as SupabaseClient)
    .from("dm_reports")
    .select("message_snapshot");
  const reportBlob = reportError ? "" : JSON.stringify(reports ?? []);
  if (reportError) console.error("[private-storage] report lookup failed", reportError);

  for (const key of candidates) {
    const referenced = await countReferences(db, "dm_messages", "image_key", key);
    const assetPath = dmKeyToAssetPath(key);
    if (
      referenced === null ||
      referenced > 0 ||
      (assetPath !== null && reportBlob.includes(assetPath))
    ) {
      kept.push(key);
      continue;
    }
    try {
      await deletePrivateObject(key);
      deleted.push(key);
    } catch (error) {
      console.error("[private-storage] DM image delete failed", { key, error });
      kept.push(key);
    }
  }

  return { deleted, kept };
}

export interface AccountPrivateFiles {
  resumeKeys: string[];
  verificationKeys: string[];
  dmKeys: string[];
}

/** Every private key an account owns, collected before the cascade delete. */
export async function collectAccountPrivateFiles(
  db: Db,
  userId: string,
): Promise<AccountPrivateFiles> {
  const [saved, applications, verifications, messages] = await Promise.all([
    (db as unknown as SupabaseClient)
      .from("member_resumes")
      .select("storage_key, url")
      .eq("user_id", userId),
    (db as unknown as SupabaseClient)
      .from("job_applications")
      .select("resume_key, resume_url")
      .eq("applicant_id", userId),
    (db as unknown as SupabaseClient)
      .from("account_verification_requests")
      .select("work_sample_keys, work_sample_urls")
      .eq("user_id", userId),
    (db as unknown as SupabaseClient)
      .from("dm_messages")
      .select("image_key, image_url")
      .eq("user_id", userId),
  ]);

  const resumeKeys = uniqueKeys([
    ...(saved.data ?? []).flatMap((row) => [row.storage_key, ...legacyKeysFromUrls([row.url])]),
    ...(applications.data ?? []).flatMap((row) => [
      row.resume_key,
      ...legacyKeysFromUrls([row.resume_url]),
    ]),
  ]);

  const verificationKeys = uniqueKeys([
    ...(verifications.data ?? []).flatMap((row) => [
      ...(row.work_sample_keys ?? []),
      ...legacyKeysFromUrls(row.work_sample_urls ?? []),
    ]),
  ]);

  const dmKeys = uniqueKeys([
    ...(messages.data ?? []).flatMap((row) => [
      row.image_key,
      ...legacyKeysFromUrls([row.image_url]),
    ]),
  ]);

  return { resumeKeys, verificationKeys, dmKeys };
}

/** Reclaim everything collected for a deleted account. */
export async function deleteAccountPrivateFiles(
  db: Db,
  files: AccountPrivateFiles,
): Promise<{ deleted: number; kept: number }> {
  const [resumes, verifications, messages] = await Promise.all([
    deletePrivateResumeKeysIfUnreferenced(db, files.resumeKeys),
    deletePrivateVerificationKeys(db, files.verificationKeys),
    deletePrivateDmKeys(db, files.dmKeys),
  ]);
  return {
    deleted: resumes.deleted.length + verifications.deleted.length + messages.deleted.length,
    kept: resumes.kept.length + verifications.kept.length + messages.kept.length,
  };
}
