import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  collectJobResumeKeys,
  deletePrivateResumeKeysIfUnreferenced,
} from "@/lib/private-storage-cleanup";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/admin/jobs/[id]
 *
 * Removes one posting outright — the moderation lever for fake or spam jobs.
 * Same consequences as the poster's own delete: the row and its applications
 * cascade away, and any resume objects stay in R2 for the orphan audit to
 * reclaim. The member-facing delete (`delete_job_post`) is owner-scoped, so
 * an admin action goes through the service client directly, the same way the
 * admin community delete does.
 *
 * Job-match notifications carry no FK to the posting (they snapshot title and
 * href), so they are swept explicitly — a member must not tap "View job" into
 * a posting that no longer exists.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  }

  const db = createServiceClient();
  const resumeKeys = await collectJobResumeKeys(db, id);

  const { data, error } = (await (db as unknown as SupabaseClient)
    .from("job_posts")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: unknown;
  };

  if (error) {
    console.error("[admin/jobs] delete error:", error);
    return NextResponse.json({ error: "Failed to delete the job." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  await deletePrivateResumeKeysIfUnreferenced(db, resumeKeys).catch((cleanupError) =>
    console.error("[admin/jobs] private resume cleanup failed:", cleanupError),
  );

  const sweep = await db
    .from("notifications")
    .delete()
    .eq("entity_type", "job")
    .eq("entity_id", id);
  if (sweep.error) {
    // The posting is gone — never fail the request for the notification sweep.
    console.error("[admin/jobs] notification sweep failed:", sweep.error);
  }

  return NextResponse.json({ success: true, job_id: id });
}
