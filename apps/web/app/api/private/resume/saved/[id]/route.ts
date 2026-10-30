import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { canViewSavedResume } from "@/lib/private-access";
import {
  isPrivateStorageConfigured,
  legacyPrivateKeyFromUrl,
  signPrivateGet,
} from "@/lib/r2-private";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = () =>
  NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/private/resume/saved/[id] — the member's own saved résumé.
 *
 * Scoped by `user_id` in the query, so another member's id is indistinguishable
 * from a deleted one. The redirect carries a 5-minute presigned URL.
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
  const { data } = await db
    .from("member_resumes")
    .select("id, user_id, url, storage_key")
    .eq("id", id)
    .eq("user_id", session.userId!)
    .maybeSingle();

  if (!data) return NOT_FOUND();
  if (!canViewSavedResume({ viewerId: session.userId!, ownerId: data.user_id })) {
    return NOT_FOUND();
  }

  if (!data.storage_key) {
    if (!data.url || !legacyPrivateKeyFromUrl(data.url)) return NOT_FOUND();
    return NextResponse.redirect(data.url, 302);
  }

  if (!isPrivateStorageConfigured()) {
    return NextResponse.json(
      { error: "Private storage is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const signed = await signPrivateGet(data.storage_key, { expiresInSeconds: 300 });
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: signed,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[private/resume] saved signing failed:", error);
    return NextResponse.json({ error: "Resume unavailable." }, { status: 500 });
  }
}
