import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCommunityPreview } from "@/lib/communities/preview";

/**
 * GET /api/communities/[id]/preview
 *
 * The read-only community preview for non-members — the same payload the
 * community page server-renders into CommunityPreview. The homepage's
 * "posted in …" modal fetches this when a non-member clicks a feed card's
 * community label, so the popup shows the identical card with the identical
 * Join rules without leaving the feed. Members never call it (the label only
 * opens the modal for non-members).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const preview = await loadCommunityPreview(createServiceClient(), id, session.userId!).catch(() => null);

  if (!preview) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  return NextResponse.json({ preview });
}
