import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }

  const { id: communityId, resourceId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  // Verify membership
  const { data: membership } = await db
    .from("community_members")
    .select("joined_at")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });

  // Verify resource exists
  const { data: resource } = await db
    .from("community_resources")
    .select("id")
    .eq("id", resourceId)
    .eq("community_id", communityId)
    .maybeSingle();
  if (!resource) return NextResponse.json({ error: "Resource not found." }, { status: 404 });

  // Toggle: check if already saved
  const { data: existing } = await db
    .from("resource_saves")
    .select("resource_id")
    .eq("resource_id", resourceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Unsave
    const { error } = await db
      .from("resource_saves")
      .delete()
      .eq("resource_id", resourceId)
      .eq("user_id", userId);
    if (error) { console.error("[DELETE save]", error); return NextResponse.json({ error: "Failed to unsave resource." }, { status: 500 }); }
    return NextResponse.json({ saved: false });
  } else {
    // Save
    const { error } = await db
      .from("resource_saves")
      .insert({ resource_id: resourceId, user_id: userId });
    if (error) { console.error("[INSERT save]", error); return NextResponse.json({ error: "Failed to save resource." }, { status: 500 }); }
    return NextResponse.json({ saved: true }, { status: 201 });
  }
}
