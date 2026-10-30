import { deleteR2AssetIfUnreferenced } from "@/lib/r2";
import {
  ALL_MEDIA_LOOKUPS,
  cleanupCommunityMedia,
  collectCommunityMediaUrls,
  type DbClient,
} from "@/lib/r2-cleanup";
import {
  collectAccountPrivateFiles,
  deleteAccountPrivateFiles,
} from "@/lib/private-storage-cleanup";

export interface DeletedAccountSummary {
  transferred: Array<{ id: string; name: string; new_owner_id: string }>;
  deleted: Array<{ id: string; name: string }>;
  r2Cleanup: Array<{
    community_id: string;
    deleted: number;
    skipped: number;
    failed: number;
  }>;
  /** Private-bucket files (résumés, verification samples, DM images). */
  privateR2: {
    deleted: number;
    kept: number;
  };
}

/**
 * Deletes an account and reclaims its media.
 *
 * The `users` row is the root: `designer_profiles`, content, memberships,
 * messages, applications and push tokens all reference it with
 * `on delete cascade`, and a `before delete` trigger hands each owned
 * community to the longest-standing remaining member (or deletes it when
 * nobody is left). R2 is outside the database, so the avatar and the media of
 * communities that disappear are cleaned up explicitly afterwards.
 *
 * Moderation reports are the deliberate exception to the cascade: the
 * `trg_anonymize_deleted_user_reports` trigger detaches every report this
 * account filed (and every post/DM report) in the same transaction, leaving
 * the report, evidence snapshot and audit links intact with no reporter
 * identity. Do not delete those rows here — they are retained evidence.
 *
 * Shared by the member-facing `/api/account/delete` and the admin
 * `DELETE /api/admin/users/[id]` so both paths behave identically.
 */
export async function deleteAccountCascade(
  db: DbClient,
  userId: string,
  options?: { expectedPasswordHash?: string },
): Promise<DeletedAccountSummary> {
  const { data: profile } = (await db
    .from("designer_profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle()) as unknown as { data: { avatar_url: string | null } | null };
  const avatarUrl = profile?.avatar_url ?? null;

  // Private files live outside the public-bucket orphan audit; collect their
  // keys before the cascade removes the rows that point at them.
  const privateFiles = await collectAccountPrivateFiles(db, userId);

  // Work out which owned communities the trigger will delete before the
  // cascade, because their media URLs become unrecoverable afterwards.
  const { data: ownedRows } = await db
    .from("communities")
    .select("id, name")
    .eq("owner_id", userId);

  const transferred: DeletedAccountSummary["transferred"] = [];
  const removed: Array<{ id: string; name: string; urls: string[] }> = [];

  for (const community of (ownedRows ?? []) as Array<{ id: string; name: string }>) {
    const { data: successor } = await db
      .from("community_members")
      .select("user_id")
      .eq("community_id", community.id)
      .neq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (successor?.user_id) {
      transferred.push({
        id: community.id,
        name: community.name,
        new_owner_id: successor.user_id,
      });
    } else {
      removed.push({
        id: community.id,
        name: community.name,
        urls: await collectCommunityMediaUrls(db, community.id),
      });
    }
  }

  // One delete for the account and everything that cascades from it. The
  // profile is not deleted by hand: its FK already cascades, and deleting it
  // first used to leave an account that could not sign in if this failed.
  // The optional hash guard closes the same race as password change: if a
  // reset commits between the route's bcrypt compare and this delete, the
  // delete matches nothing and the account is not erased.
  let deleteQuery = db.from("users").delete().eq("id", userId);
  if (options?.expectedPasswordHash) {
    deleteQuery = deleteQuery.eq("password_hash", options.expectedPasswordHash);
  }
  const { data: deletedRows, error } = await deleteQuery.select("id");
  if (error) {
    throw new Error(`users delete failed: ${error.message}`);
  }
  if (!deletedRows || deletedRows.length === 0) {
    throw new Error("password_changed");
  }

  if (avatarUrl) {
    try {
      const outcome = await deleteR2AssetIfUnreferenced(db, avatarUrl, ALL_MEDIA_LOOKUPS);
      if (outcome.status !== "deleted" && outcome.status !== "referenced") {
        console.warn("[account-delete] avatar cleanup outcome:", outcome.status);
      }
    } catch (avatarCleanupError) {
      // Non-fatal: the admin orphan scan retries this.
      console.error("[account-delete] avatar cleanup error:", avatarCleanupError);
    }
  }

  const r2Cleanup: DeletedAccountSummary["r2Cleanup"] = [];
  for (const community of removed) {
    try {
      const cleanup = await cleanupCommunityMedia(db, community.id, community.urls);
      r2Cleanup.push({
        community_id: community.id,
        deleted: cleanup.deleted.length,
        skipped: cleanup.skipped.length,
        failed: cleanup.failed.length,
      });
    } catch (cleanupError) {
      console.error("[account-delete] community R2 cleanup error:", cleanupError);
      r2Cleanup.push({
        community_id: community.id,
        deleted: 0,
        skipped: 0,
        failed: community.urls.length,
      });
    }
  }

  const privateR2 = await deleteAccountPrivateFiles(db, privateFiles);

  return {
    transferred,
    deleted: removed.map(({ id, name }) => ({ id, name })),
    r2Cleanup,
    privateR2,
  };
}
