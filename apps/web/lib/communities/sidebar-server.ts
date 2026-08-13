import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getMasterImageMap, getMasterNameMap, TABLE_LOOKUP } from "@/lib/master-data-cache";

type ActivityRow = {
  community_id: string;
  joined_at: string | null;
  last_read_at: string | null;
  archived_at: string | null;
  member_count: number;
  unread_count: number;
  last_message: null | {
    id: string;
    content: string | null;
    created_at: string;
    user_id: string;
    sender_name: string | null;
    reply_to_id: string | null;
    reply_sender_name: string | null;
    deleted_at: string | null;
    has_image: boolean;
  };
  last_reaction: null | {
    message_id: string;
    user_id: string;
    emoji: string;
    created_at: string;
    reactor_name: string | null;
    message_content: string | null;
    has_image: boolean;
  };
};

export async function getSidebarCommunities(userId: string) {
  const db = createServiceClient();
  const { data: activity, error: activityError } = await db.rpc("get_sidebar_activity", {
    p_user_id: userId,
  });
  if (activityError) {
    console.error("[GET communities projection]", activityError);
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }

  const rows = (Array.isArray(activity) ? activity : []) as ActivityRow[];
  if (!rows.length) return NextResponse.json({ communities: [] });
  const activityById = new Map(rows.map((row) => [row.community_id, row]));
  const { data: communities, error } = await db
    .from("communities")
    .select("id, name, type, image_url, reference_id, is_private, enabled_tabs, owner_id, created_at")
    .in("id", rows.map((row) => row.community_id))
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });

  const byType: Record<string, { id: string; reference_id: string }[]> = {};
  for (const community of communities ?? []) {
    if (!byType[community.type]) byType[community.type] = [];
    byType[community.type].push({ id: community.id, reference_id: community.reference_id });
  }
  const images: Record<string, string | null> = {};
  const names: Record<string, string | null> = {};
  const validIds = new Set<string>();
  await Promise.all(Object.entries(byType).map(async ([type, items]) => {
    if (!TABLE_LOOKUP[type]) {
      items.forEach((item) => validIds.add(item.id));
      return;
    }
    const [imageMap, nameMap] = await Promise.all([getMasterImageMap(type), getMasterNameMap(type)]);
    for (const item of items) {
      if (!(item.reference_id in imageMap)) continue;
      validIds.add(item.id);
      images[item.id] = imageMap[item.reference_id] ?? null;
      names[item.id] = nameMap[item.reference_id] ?? null;
    }
  }));

  const result = (communities ?? []).filter((community) => validIds.has(community.id)).map((community) => {
    const row = activityById.get(community.id)!;
    const message = row.last_message;
    const reaction = row.last_reaction;
    return {
      ...community,
      image_url: images[community.id] ?? community.image_url ?? null,
      reference_name: names[community.id] ?? null,
      member_count: row.member_count,
      message_count: row.unread_count,
      last_read_at: row.last_read_at,
      joined_at: row.joined_at,
      is_archived: Boolean(row.archived_at && (!message || message.created_at <= row.archived_at)),
      last_message: message ? {
        id: message.id,
        content: message.content ?? "",
        created_at: message.created_at,
        user: { name: message.sender_name ?? "Unknown" },
        is_own: message.user_id === userId,
        has_image: message.has_image,
        is_deleted: Boolean(message.deleted_at),
        is_reply: Boolean(message.reply_to_id),
        reply_to_user: message.reply_sender_name?.split(" ")[0] ?? null,
      } : null,
      lastReaction: reaction ? {
        messageId: reaction.message_id,
        emoji: reaction.emoji,
        createdAt: reaction.created_at,
        firstName: reaction.user_id === userId ? "You" : reaction.reactor_name?.split(" ")[0] ?? "Someone",
        isOwn: reaction.user_id === userId,
        messagePreview: reaction.message_content
          ? `"${reaction.message_content.slice(0, 40)}${reaction.message_content.length > 40 ? "…" : ""}"`
          : reaction.has_image ? "Photo" : "a message",
      } : null,
    };
  }).sort((a, b) => (b.last_message?.created_at ?? "").localeCompare(a.last_message?.created_at ?? ""));

  return NextResponse.json({ communities: result });
}
