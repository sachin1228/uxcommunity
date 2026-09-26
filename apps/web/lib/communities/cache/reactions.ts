import type { MessageReaction } from "./types";

export function applyReactionInsert(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  const without = reactions.map((r) => ({
    ...r,
    user_ids: r.user_ids.filter((uid) => uid !== userId),
  })).filter((r) => r.user_ids.length > 0);

  const existing = without.find((r) => r.emoji === emoji);
  if (existing) {
    return without.map((r) =>
      r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, userId] } : r
    );
  }
  return [...without, { emoji, user_ids: [userId] }];
}

export function applyReactionDelete(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  return reactions
    .map((r) =>
      r.emoji === emoji
        ? { ...r, user_ids: r.user_ids.filter((uid) => uid !== userId) }
        : r
    )
    .filter((r) => r.user_ids.length > 0);
}
