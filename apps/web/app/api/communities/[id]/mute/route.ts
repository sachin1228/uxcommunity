import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { canStoreMuteUntil } from "@/lib/communities/showcase-flag";

/**
 * POST /api/communities/[id]/mute
 *
 * Sets the caller's own notification mute for one community — the membership
 * row is the only place that knows "this member, that community", so the write
 * never touches anyone else.
 *
 *   { duration: "8h" | "1w" }   timed mute (the deadline is stored, the row is
 *                              left alone when it lapses)
 *   { duration: "always" }      the forever flag (mobile's mute list reads it)
 *   { duration: "off" }         unmute — clears both forms
 *
 * Answers with the resulting state so the caller can patch its caches without
 * recomputing what the server decided.
 */

/** Wall-clock length of each timed option. */
const TIMED_MUTE_MS = {
  "8h": 8 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
} as const;

type MuteDuration = keyof typeof TIMED_MUTE_MS | "always" | "off";

function isMuteDuration(value: unknown): value is MuteDuration {
  return value === "8h" || value === "1w" || value === "always" || value === "off";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  let body: { duration?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const duration = body.duration;
  if (!isMuteDuration(duration)) {
    return NextResponse.json(
      { error: "duration must be '8h', '1w', 'always' or 'off'." },
      { status: 422 },
    );
  }

  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this community." }, { status: 403 });
  }

  // Timed mutes need the deadline column; the forever flag and unmute work
  // without it (the boolean ships with the earlier preferences migration).
  const timedAvailable = await canStoreMuteUntil(db);
  if ((duration === "8h" || duration === "1w") && !timedAvailable) {
    return NextResponse.json(
      { error: "Timed mutes aren't available yet — apply the community-mute migration." },
      { status: 503 },
    );
  }

  const mutedUntil =
    duration === "8h" || duration === "1w"
      ? new Date(Date.now() + TIMED_MUTE_MS[duration]).toISOString()
      : null;
  const mutedForever = duration === "always";

  const update =
    mutedUntil !== null
      ? { notifications_muted: false, notifications_muted_until: mutedUntil }
      : {
          notifications_muted: mutedForever,
          ...(timedAvailable ? { notifications_muted_until: null } : {}),
        };

  const { error } = await db
    .from("community_members")
    .update(update as never)
    .eq("community_id", communityId)
    .eq("user_id", userId);

  if (error) {
    console.error("[community-mute] update failed", error);
    return NextResponse.json({ error: "Failed to save notification settings." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    notifications_muted: mutedForever,
    notifications_muted_until: mutedUntil,
  });
}
