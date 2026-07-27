import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * Strip year-range suffixes and singularize experience level names for display.
 * e.g. "Mid-Level Designers (3-5 years)" → "Mid-Level Designer"
 *      "Heads of Design"                 → "Head of Design"
 */
function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

/**
 * GET /api/communities/[id]/members/[userId]
 *
 * Lightweight endpoint used by CommunityChat to lazily resolve the display
 * info (name + avatar) of a message sender who is not yet in the local
 * members cache.  Requires the *calling* user to be a member of the community.
 *
 * Returns: { name: string, avatar_url: string | null }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, userId } = await params;

  const db = createServiceClient();

  // Verify the calling user is a member of this community (auth guard).
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  // Fetch name + avatar + designation + company in parallel.
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url, experience_level, companies(name)").eq("user_id", userId).maybeSingle(),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Resolve experience level display name from slug.
  let designation: string | null = null;
  const expSlug = (profile as any)?.experience_level ?? null;
  if (expSlug) {
    const { data: expLevel } = await db
      .from("experience_levels")
      .select("name")
      .eq("slug", expSlug)
      .maybeSingle();
    designation = expLevel?.name ? cleanDesignation(expLevel.name) : null;
  }

  return NextResponse.json({
    name: user.name,
    avatar_url: profile?.avatar_url ?? null,
    designation,
    company: (profile as any)?.companies?.name ?? null,
  });
}
