import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { SUGGESTED_COMMUNITIES_TAG } from "@/lib/home/home-rail-cache";
import { canJoinEventChat } from "@/lib/communities/event-chat";
import { canStoreJoinRequestMessage } from "@/lib/communities/showcase-flag";
import { joinAnswersPayload } from "@/lib/communities/event-join-questions";
import { storeEventJoinResponse } from "@/lib/communities/event-join-responses";

/**
 * POST /api/communities/[id]/join
 *
 * Access rules:
 *  - interest / general / user  → anyone can join (unless private)
 *  - sector                     → user's sector_id must match community reference_id
 *  - city                       → user's city_id must match community reference_id
 *  - experience_level           → user's experience_level slug must resolve to matching reference_id
 *  - job_title                  → user's job_title slug must resolve to matching reference_id
 *
 * For private communities, a join request is created instead of direct membership.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;

  // Optional note accompanying a private-community request (the homepage
  // preview asks for one). Ignored everywhere else.
  const body = (await req.json().catch(() => null)) as
    | { message?: unknown; answers?: Record<string, unknown> }
    | null;
  const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";
  const requestMessage = rawMessage ? rawMessage.slice(0, 500) : null;

  const db = createServiceClient();

  // 1. Load community
  const { data: community } = await db
    .from("communities")
    .select("id, type, reference_id, is_private, event_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  // 1b. An event's group chat: joining it is the confirmation. It is open to
  // everyone who can see the event — the members of the event's own community,
  // and everybody when the event is public. There is no approval step: the
  // caller has already confirmed in the UI (RSVP, or the group's join gate) —
  // and answered the host's compulsory questions, which are recorded here so
  // the host reads them back in the members tab.
  if (community.type === "event") {
    // The questions are compulsory: the modal will not send without all four
    // answered, but the server is the referee — a join without answers is
    // refused rather than waved through.
    const answers = joinAnswersPayload(body?.answers ?? {});
    if (!answers) {
      return NextResponse.json(
        { error: "Please answer all the host's questions to join." },
        { status: 400 },
      );
    }

    const { data: eventRow } = await db
      .from("community_events")
      .select("id, community_id, is_public")
      .eq("id", community.event_id)
      .maybeSingle();

    if (!eventRow) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }

    if (!(await canJoinEventChat(db, eventRow, userId))) {
      return NextResponse.json(
        { error: "Only members of this event's community can join its chat." },
        { status: 403 },
      );
    }

    const { error } = await db
      .from("community_members")
      .upsert(
        { community_id: communityId, user_id: userId },
        { onConflict: "community_id,user_id", ignoreDuplicates: true },
      );

    if (error) {
      return NextResponse.json({ error: "Failed to join the event chat." }, { status: 500 });
    }

    // Best-effort by design (see storeEventJoinResponse): a logging failure
    // must not flip a successful join into an error the member would retry.
    await storeEventJoinResponse(db, communityId, userId, answers);

    return NextResponse.json({ success: true });
  }

  // 2. Interest / general / user communities are open to all
  const FREE_TYPES = new Set(["interest", "general", "user"]);

  if (!FREE_TYPES.has(community.type)) {
    const { data: profile } = await db
      .from("designer_profiles")
      .select("city_id, sector_id, experience_level, job_title")
      .eq("user_id", userId)
      .maybeSingle();

    let allowed = false;

    if (community.type === "sector") {
      allowed = profile?.sector_id === community.reference_id;
    } else if (community.type === "city") {
      allowed = profile?.city_id === community.reference_id;
    } else if (community.type === "experience_level" && profile?.experience_level) {
      const { data: expLevel } = await db
        .from("experience_levels")
        .select("id")
        .eq("slug", profile.experience_level)
        .maybeSingle();
      allowed = expLevel?.id === community.reference_id;
    } else if (community.type === "job_title" && profile?.job_title) {
      const { data: jobTitle } = await db
        .from("job_titles")
        .select("id")
        .eq("slug", profile.job_title)
        .maybeSingle();
      allowed = jobTitle?.id === community.reference_id;
    }

    if (!allowed) {
      const labels: Record<string, string> = {
        sector:           "industry",
        city:             "city",
        experience_level: "experience level",
        job_title:        "job title",
      };
      return NextResponse.json(
        {
          error: `You can only join this ${labels[community.type] ?? "profile"} community if it matches your profile. Update your profile to join.`,
          code:  "PROFILE_MISMATCH",
        },
        { status: 403 },
      );
    }
  }

  // 3. Private communities require owner approval
  if (community.is_private) {
    // Delete any existing declined request to allow re-requesting
    await db
      .from("community_join_requests")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .eq("status", "declined");

    // Upsert a join request (idempotent — resets to pending if previous was declined).
    // The request_message column only exists once its migration is applied, so the
    // write mentions it only there and falls back to a plain request otherwise.
    const payload: Record<string, unknown> = {
      community_id: communityId,
      user_id: userId,
      status: "pending",
    };
    if (requestMessage && (await canStoreJoinRequestMessage(db))) {
      payload.request_message = requestMessage;
    }
    // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
    const { error: reqErr } = await db
      .from("community_join_requests")
      .upsert(payload as never, { onConflict: "community_id,user_id", ignoreDuplicates: true });

    if (reqErr) {
      return NextResponse.json({ error: "Failed to submit join request." }, { status: 500 });
    }

    // The community can no longer be suggested to this member as a one-tap join.
    revalidateTag(SUGGESTED_COMMUNITIES_TAG, { expire: 0 });

    return NextResponse.json({ status: "requested", communityId });
  }

  // 4. Public communities — join immediately
  const { error } = await db
    .from("community_members")
    .upsert(
      { community_id: communityId, user_id: userId },
      { onConflict: "community_id,user_id", ignoreDuplicates: true },
    );

  if (error) {
    return NextResponse.json({ error: "Failed to join community." }, { status: 500 });
  }

  // Drop the cached suggestion lists so the homepage rail (and any other
  // surface reading them) stops offering a community this member just joined.
  revalidateTag(SUGGESTED_COMMUNITIES_TAG, { expire: 0 });

  return NextResponse.json({ success: true });
}
