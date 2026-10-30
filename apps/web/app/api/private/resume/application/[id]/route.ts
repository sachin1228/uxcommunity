import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { canViewApplicationResume } from "@/lib/private-access";
import {
  isPrivateStorageConfigured,
  legacyPrivateKeyFromUrl,
  signPrivateGet,
} from "@/lib/r2-private";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = () =>
  NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/private/resume/application/[id]
 *
 * The only way a job-application résumé is opened. The caller must be the
 * applicant or the member who posted that job; anyone else gets the same 404
 * as a missing row, so an application id cannot be probed. After the check the
 * app redirects to a 5-minute presigned GET — the URL is never stored or
 * logged, and the object itself carries `Cache-Control: private, no-store`.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();

  const db = createServiceClient();
  const { data } = (await (db as unknown as SupabaseClient)
    .from("job_applications")
    .select("id, applicant_id, resume_key, resume_url, jobs:job_posts!inner(poster_id)")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      applicant_id: string;
      resume_key: string | null;
      resume_url: string | null;
      jobs: { poster_id: string } | null;
    } | null;
  };

  if (!data) return NOT_FOUND();

  const allowed = canViewApplicationResume({
    viewerId: session.userId!,
    applicantId: data.applicant_id,
    posterId: data.jobs?.poster_id ?? null,
  });
  if (!allowed) return NOT_FOUND();

  // Un-migrated rows still live in the public bucket: redirect to that URL
  // until the migration script moves them. New rows take the private path.
  if (!data.resume_key) {
    const legacy = data.resume_url;
    if (!legacy || !legacyPrivateKeyFromUrl(legacy)) return NOT_FOUND();
    return NextResponse.redirect(legacy, 302);
  }

  if (!isPrivateStorageConfigured()) {
    return NextResponse.json(
      { error: "Private storage is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const signed = await signPrivateGet(data.resume_key, { expiresInSeconds: 300 });
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[private/resume] signing failed:", error);
    return NextResponse.json({ error: "Resume unavailable." }, { status: 500 });
  }
}
