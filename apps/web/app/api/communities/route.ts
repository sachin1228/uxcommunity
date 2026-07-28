import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { getMasterImageMap, getMasterNameMap, TABLE_LOOKUP } from "@/lib/master-data-cache";
import { compressAvatar } from "@/lib/image-utils";
import { uploadToR2 } from "@/lib/r2";
import { validateAndModerateImage } from "@/lib/moderation/image";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const VALID_TABS = new Set(["chat", "threads", "events", "resources"]);

function parseString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonArray(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "community";
}

export async function GET() {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;

  const db = createServiceClient();

  // 1. Community IDs this user belongs to, plus their last_read_at per community
  const { data: memberships, error: mErr } = await db
    .from("community_members")
    .select("community_id, last_read_at, archived_at, joined_at")
    .eq("user_id", userId);

  if (mErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  if (!memberships?.length) return NextResponse.json({ communities: [] });

  const ids = memberships.map((m) => m.community_id);

  // Build a per-community last_read_at map for unread counting below.
  const lastReadMap: Record<string, string | null> = {};
  const archivedAtMap: Record<string, string | null> = {};
  const joinedAtMap: Record<string, string | null> = {};
  for (const m of memberships) {
    lastReadMap[m.community_id] = (m as any).last_read_at ?? null;
    archivedAtMap[m.community_id] = (m as any).archived_at ?? null;
    joinedAtMap[m.community_id] = (m as any).joined_at ?? null;
  }

  // 2. Community rows + all member counts + recent messages — all in parallel
  const [
    { data: communities, error: cErr },
    { data: allMembers },
    { data: recentMessages },
  ] = await Promise.all([
    db.from("communities").select("id, name, type, image_url, reference_id, is_private, enabled_tabs, owner_id, created_at").in("id", ids).eq("is_active", true),
    // Single query for all member counts (replaces N individual count queries)
    db.from("community_members").select("community_id").in("community_id", ids),
    // Fetch the latest messages across all communities.
    db
      .from("community_messages")
      .select("id, community_id, content, created_at, user_id, reply_to_id")
      .in("community_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 10),
  ]);

  if (cErr) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });

  // 3. Count members per community in JS (1 query instead of N)
  const countMap: Record<string, number> = {};
  for (const m of allMembers ?? []) {
    countMap[m.community_id] = (countMap[m.community_id] ?? 0) + 1;
  }

  // 4. Pick the latest message per community AND count unread messages in JS.
  const lastMsgByComm: Record<string, { id: string; community_id: string; content: string; created_at: string; user_id: string; reply_to_id?: string | null }> = {};
  const msgCountMap: Record<string, number> = {};
  for (const m of recentMessages ?? []) {
    if (!lastMsgByComm[m.community_id]) {
      lastMsgByComm[m.community_id] = m;
    }
    if (m.user_id !== userId) {
      const lastRead = lastReadMap[m.community_id] ?? null;
      if (!lastRead || m.created_at > lastRead) {
        msgCountMap[m.community_id] = (msgCountMap[m.community_id] ?? 0) + 1;
      }
    }
  }

  // 5. Batch-fetch sender names for last messages (1 query instead of N)
  const senderIds = [...new Set(Object.values(lastMsgByComm).map((m) => m.user_id))];

  // Collect reply_to_ids from last messages so we can resolve the replied-to user names.
  const replyToIds = [
    ...new Set(
      Object.values(lastMsgByComm)
        .map((m) => m.reply_to_id)
        .filter((id): id is string => !!id),
    ),
  ];

  // 5b. Fetch the most recent reaction in each community so the sidebar can
  //     show "You reacted 🔥 to: …" even when the reacted message is not the
  //     latest message.
  const [{ data: senderUsers }, { data: recentReactions }, { data: replyParentRows }] = await Promise.all([
    senderIds.length
      ? db.from("users").select("id, name").in("id", senderIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ids.length
      ? db
          .from("message_reactions")
          .select("community_id, message_id, user_id, emoji, created_at")
          .in("community_id", ids)
          .order("created_at", { ascending: false })
      : Promise.resolve({
          data: [] as {
            community_id: string;
            message_id: string;
            user_id: string;
            emoji: string;
            created_at: string;
          }[],
        }),
    replyToIds.length
      ? db.from("community_messages").select("id, user_id").in("id", replyToIds)
      : Promise.resolve({ data: [] as { id: string; user_id: string }[] }),
  ]);

  // Resolve names for reply-parent senders.
  const replyParentUserIds = [...new Set((replyParentRows ?? []).map((m) => m.user_id))];
  const { data: replyParentUsers } = replyParentUserIds.length
    ? await db.from("users").select("id, name").in("id", replyParentUserIds)
    : { data: [] as { id: string; name: string }[] };

  // Map: parent message id → first name of original sender.
  const replyParentNameMap: Record<string, string> = {};
  const replyParentUserMap = Object.fromEntries((replyParentUsers ?? []).map((u) => [u.id, u.name]));
  for (const m of replyParentRows ?? []) {
    const name = replyParentUserMap[m.user_id];
    if (name) replyParentNameMap[m.id] = name.split(" ")[0];
  }

  // Pick the most-recent reaction per community.
  const latestReactionByCommunity: Record<
    string,
    { message_id: string; user_id: string; emoji: string; created_at: string }
  > = {};
  for (const r of recentReactions ?? []) {
    if (!latestReactionByCommunity[r.community_id]) {
      latestReactionByCommunity[r.community_id] = {
        message_id: r.message_id,
        user_id: r.user_id,
        emoji: r.emoji,
        created_at: r.created_at,
      };
    }
  }

  const reactionMessageIds = Object.values(latestReactionByCommunity).map(
    (r) => r.message_id,
  );
  const reactorIds = [
    ...new Set(Object.values(latestReactionByCommunity).map((r) => r.user_id)),
  ];

  // Fetch the reacted-to message and names for reactors not already in senderIds.
  const [{ data: reactionMessages }, { data: reactorUsers }] = await Promise.all([
    reactionMessageIds.length
      ? db
          .from("community_messages")
          .select("id, content, image_url")
          .in("id", reactionMessageIds)
      : Promise.resolve({
          data: [] as { id: string; content: string | null; image_url: string | null }[],
        }),
    reactorIds.length
      ? db.from("users").select("id, name").in("id", reactorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const reactionMessageMap = Object.fromEntries(
    (reactionMessages ?? []).map((m) => [m.id, m]),
  );

  const senderMap = Object.fromEntries((senderUsers ?? []).map((u) => [u.id, u.name]));
  // Merge reactor names into senderMap for convenient lookup
  for (const u of reactorUsers ?? []) senderMap[u.id] = u.name;

  // 6. Resolve image_url from cached master tables (zero DB round-trip on warm cache).
  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const c of communities ?? []) {
    if (!byType[c.type]) byType[c.type] = [];
    byType[c.type].push({ id: c.id, reference_id: c.reference_id });
  }

  const masterImageMap: Record<string, string | null> = {};
  const masterNameMap: Record<string, string | null> = {};
  const validCommunityIds = new Set<string>();

  await Promise.all(
    Object.entries(byType).map(async ([type, items]) => {
      if (!TABLE_LOOKUP[type]) {
        for (const item of items) validCommunityIds.add(item.id);
        return;
      }

      // Cached fetch — warm after the first request per deploy
      const [imgMap, nameMap] = await Promise.all([
        getMasterImageMap(type),
        getMasterNameMap(type),
      ]);

      for (const item of items) {
        if (item.reference_id in imgMap) {
          validCommunityIds.add(item.id);
          masterImageMap[item.id] = imgMap[item.reference_id] ?? null;
          masterNameMap[item.id] = nameMap[item.reference_id] ?? null;
        }
        // reference_id not found → master row deleted → skip
      }
    })
  );

  // 7. Assemble — only communities with live master data
  const result = (communities ?? [])
    .filter((c) => validCommunityIds.has(c.id))
    .map((c) => {
      const lastMsg = lastMsgByComm[c.id] ?? null;
      const latestReaction = latestReactionByCommunity[c.id];
      const reactionMessage = latestReaction
        ? reactionMessageMap[latestReaction.message_id]
        : undefined;

      // Reconstruct the sidebar lastReaction preview so it survives page refresh.
      // Only show the reaction if it is strictly more recent than the last message.
      // If a newer message exists, it takes priority — mirroring what useSidebarRealtime
      // does when it clears lastReaction on a new-message INSERT event.
      const reactionIsLatest =
        latestReaction &&
        (!lastMsg || latestReaction.created_at > lastMsg.created_at);

      const lastReaction = reactionIsLatest
        ? {
            messageId: latestReaction!.message_id,
            emoji: latestReaction!.emoji,
            createdAt: latestReaction!.created_at,
            firstName:
              latestReaction!.user_id === userId
                ? "You"
                : (senderMap[latestReaction!.user_id]?.split(" ")[0] ?? "Someone"),
            isOwn: latestReaction!.user_id === userId,
            messagePreview: reactionMessage?.content
              ? `"${reactionMessage.content.slice(0, 40)}${reactionMessage.content.length > 40 ? "…" : ""}"`
              : "📷 Photo",
          }
        : null;

      return {
        ...c,
        image_url: masterImageMap[c.id] ?? c.image_url ?? null,
        reference_name: masterNameMap[c.id] ?? null,
        member_count: countMap[c.id] ?? 0,
        message_count: msgCountMap[c.id] ?? 0,
        last_read_at: lastReadMap[c.id] ?? null,
        joined_at: joinedAtMap[c.id] ?? null,
        is_archived: !!archivedAtMap[c.id] &&
          (!lastMsg || lastMsg.created_at <= archivedAtMap[c.id]!),
        last_message: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.content,
              created_at: lastMsg.created_at,
              user: { name: senderMap[lastMsg.user_id] ?? "Unknown" },
              is_reply: !!lastMsg.reply_to_id,
              reply_to_user: lastMsg.reply_to_id
                ? (replyParentNameMap[lastMsg.reply_to_id] ?? null)
                : null,
            }
          : null,
        lastReaction,
      };
    })
    .sort((a, b) => {
      const ta = a.last_message?.created_at ?? "";
      const tb = b.last_message?.created_at ?? "";
      return tb > ta ? 1 : -1;
    });

  return NextResponse.json({ communities: result });
}

export async function POST(request: Request) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const db = createServiceClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const name = parseString(formData.get("name"));
  const description = parseString(formData.get("description"));
  const isPrivate = parseString(formData.get("privacy")) === "private";
  const tabs = Array.from(new Set(["chat", ...parseJsonArray(formData.get("tabs"))]))
    .filter((tab) => VALID_TABS.has(tab));
  const rules = parseJsonArray(formData.get("rules"))
    .map((rule) => rule.trim())
    .filter(Boolean)
    .slice(0, 8);

  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: "Community name must be 1-80 characters." }, { status: 422 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: "Description must be 500 characters or less." }, { status: 422 });
  }

  let imageUrl: string | null = null;
  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG and WebP images are allowed." }, { status: 422 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Community picture must be under 10 MB." }, { status: 422 });
    }

    const moderation = await validateAndModerateImage(file);
    await logModerationDecision(db, {
      userId,
      contentType: "image_upload",
      decision: moderation.decision,
    });
    if (!moderation.decision.allowed || !moderation.buffer) {
      return moderationFailureResponse(moderation.decision);
    }

    try {
      const compressed = await compressAvatar(moderation.buffer);
      const key = `communities/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${compressed.ext}`;
      imageUrl = await uploadToR2(key, compressed.data, compressed.contentType);
    } catch (err) {
      console.error("[community-create] image upload failed:", err);
      return NextResponse.json({ error: "Community picture upload failed." }, { status: 500 });
    }
  }

  const inviteToken = randomUUID().replace(/-/g, "");
  const { data: community, error: communityError } = await db
    .from("communities")
    .insert({
      name,
      description: description || null,
      type: "user",
      reference_id: null,
      image_url: imageUrl,
      owner_id: userId,
      is_private: isPrivate,
      invite_token: inviteToken,
      enabled_tabs: tabs,
      is_active: true,
    })
    .select("id, name, type, image_url, is_private, invite_token, enabled_tabs")
    .single();

  if (communityError || !community) {
    console.error("[community-create] insert failed:", communityError);
    return NextResponse.json({ error: "Failed to create community." }, { status: 500 });
  }

  const { error: memberError } = await db
    .from("community_members")
    .insert({
      community_id: community.id,
      user_id: userId,
      role: "owner",
    });

  if (memberError) {
    await db.from("communities").delete().eq("id", community.id);
    console.error("[community-create] owner membership failed:", memberError);
    return NextResponse.json({ error: "Failed to create community membership." }, { status: 500 });
  }

  const rulesToInsert = rules.length
    ? rules
    : [
        "Be respectful and kind to all members.",
        "Keep discussions relevant to this community.",
        "No spam or unsolicited promotion.",
      ];

  await db.from("community_rules").insert(
    rulesToInsert.map((rule, index) => ({
      community_id: community.id,
      rule_text: rule,
      order_index: index,
    }))
  );

  const slug = slugify(name);
  const host = request.headers.get("host") ?? "drafthub.co";
  const protocol = host.includes("localhost") ? "http" : "https";

  return NextResponse.json({
    community: {
      ...community,
      member_count: 1,
      invite_url: `${protocol}://${host}/join/${slug}-${inviteToken}`,
    },
  }, { status: 201 });
}
