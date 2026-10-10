import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityMediaPage } from "@/lib/communities/read-models";

/**
 * The community Media tab's paginated feed (thread images, showcase
 * images/videos, event covers). Membership is enforced inside the read model's
 * RPC — the route only supplies the session user id.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (e) {
    return e as Response;
  }

  const { id: communityId } = await params;
  const result = await loadCommunityMediaPage(
    communityId,
    session.userId!,
    req.nextUrl.searchParams.get("cursor"),
  );

  return result.ok
    ? NextResponse.json(result.data)
    : NextResponse.json({ error: result.error }, { status: result.status });
}
