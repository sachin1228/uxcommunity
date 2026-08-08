import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/communities/[id]/invite/regenerate
 * Regenerate the invite token. Owner only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id, name, owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const newToken = randomUUID().replace(/-/g, "");

  const { error } = await db
    .from("communities")
    .update({ invite_token: newToken })
    .eq("id", communityId);

  if (error) return NextResponse.json({ error: "Failed to regenerate link." }, { status: 500 });

  function slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "community";
  }

  const host = _req.headers.get("host") ?? "uxcommunity.in";
  const protocol = host.includes("localhost") ? "http" : "https";
  const slug = slugify(community.name);

  return NextResponse.json({
    invite_token: newToken,
    invite_url: `${protocol}://${host}/join/${slug}-${newToken}`,
  });
}
