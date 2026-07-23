import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";

export async function GET() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const [
    { data: user },
    { data: profile },
    { data: userInterests },
    { data: allInterests },
  ] = await Promise.all([
    db.from("users").select("name, email, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, avatar_source, experience_level, linkedin_url, portfolio_url, bio, cities(id, name), companies(id, name), design_sectors(id, name)"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("user_interests").select("interest_id, design_interests(id, name, image_url)").eq("user_id", userId),
    db.from("design_interests").select("id, name, image_url").eq("is_active", true).order("name"),
  ]);

  return NextResponse.json({
    user,
    profile,
    userInterests: (userInterests ?? []).map((r: any) => r.design_interests).filter(Boolean),
    allInterests: allInterests ?? [],
  });
}

export async function PATCH(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  let body: {
    name?: string;
    bio?: string;
    linkedin_url?: string;
    portfolio_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const db = createServiceClient();
  const userId = session.userId!;

  // Update user name if provided
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 422 });
    }
    const decision = await moderateText({ content: trimmed, contentType: "username", userId });
    await logModerationDecision(db, {
      userId,
      contentType: "username",
      contentHash: contentHash(trimmed),
      decision,
    });
    if (!decision.allowed) return moderationFailureResponse(decision);

    const { error } = await db.from("users").update({ name: trimmed }).eq("id", userId);
    if (error) {
      console.error("[profile PATCH] name update error:", error);
      return NextResponse.json({ error: "Failed to update name." }, { status: 500 });
    }
  }

  // Update profile fields if provided
  const profilePatch: Record<string, string | null> = {};
  if (typeof body.bio === "string") {
    const bio = body.bio.trim();
    if (bio) {
      const decision = await moderateText({ content: bio, contentType: "user_bio", userId });
      await logModerationDecision(db, {
        userId,
        contentType: "user_bio",
        contentHash: contentHash(bio),
        decision,
      });
      if (!decision.allowed) return moderationFailureResponse(decision);
    }
    profilePatch.bio = bio || null;
  }
  if (typeof body.linkedin_url === "string") profilePatch.linkedin_url = body.linkedin_url.trim() || null;
  if (typeof body.portfolio_url === "string") profilePatch.portfolio_url = body.portfolio_url.trim() || null;

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await db.from("designer_profiles").update(profilePatch).eq("user_id", userId);
    if (error) {
      console.error("[profile PATCH] profile update error:", error);
      return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
