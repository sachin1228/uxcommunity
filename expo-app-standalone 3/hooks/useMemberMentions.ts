/**
 * Composer @-autocomplete for the chat — a React Native port of the web
 * `useMemberMentions`.
 *
 * Storage contract (same as web): the message text keeps the raw `@Name`
 * token, while `community_messages.mentions` stores `{ user_id, name }[]` for
 * the members actually *picked* from the list. Typing `@Name` by hand never
 * registers a mention, and deleting an inserted one drops it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCommunityMembers } from '@/lib/communities';
import {
  detectMentionTrigger,
  resolveMentionsFromText,
  type MentionCandidate,
  type MessageMention,
} from '@/lib/chat';

/** Max rows shown at once — matches the web popover. */
const MAX_OPTIONS = 30;

interface RosterEntry {
  members: MentionCandidate[];
  fetchedAt: number;
}

// Module-level roster cache, shared across chat visits.
const rosterCache = new Map<string, RosterEntry>();
const inflightRoster = new Map<string, Promise<MentionCandidate[]>>();

/** Loads (and caches) a community's member roster so the picker is instant. */
async function loadRoster(communityId: string): Promise<MentionCandidate[]> {
  const cached = rosterCache.get(communityId);
  if (cached) return cached.members;

  const inflight = inflightRoster.get(communityId);
  if (inflight) return inflight;

  const promise = getCommunityMembers(communityId)
    .then((members) => {
      rosterCache.set(communityId, { members, fetchedAt: Date.now() });
      return members;
    })
    .catch(() => [] as MentionCandidate[])
    .finally(() => {
      inflightRoster.delete(communityId);
    });

  inflightRoster.set(communityId, promise);
  return promise;
}

interface MentionContext {
  start: number;
  query: string;
}

export function useMemberMentions({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [ctx, setCtx] = useState<MentionContext | null>(null);
  const [roster, setRoster] = useState<MentionCandidate[]>([]);

  /** Mentions the composer registered by *picking* them from the list. */
  const registryRef = useRef<Map<string, MessageMention>>(new Map());

  const scopeRef = useRef({ communityId, currentUserId });
  scopeRef.current = { communityId, currentUserId };

  const ensureRoster = useCallback(async () => {
    const members = await loadRoster(communityId);
    const scope = scopeRef.current;
    if (scope.communityId !== communityId || scope.currentUserId !== currentUserId) return;
    setRoster(members);
  }, [communityId, currentUserId]);

  const onComposerActivity = useCallback(
    (text: string, caret: number) => {
      const trigger = detectMentionTrigger(text, caret);
      setCtx(trigger);
      if (trigger) void ensureRoster();
    },
    [ensureRoster],
  );

  const close = useCallback(() => setCtx(null), []);

  /** Members matching the current query, minus the current user. */
  const options = useMemo(() => {
    if (!ctx) return [];
    const query = ctx.query.trim().toLowerCase();
    return roster
      .filter((member) => member.user_id !== currentUserId)
      .filter((member) => !query || member.name.toLowerCase().includes(query))
      .slice(0, MAX_OPTIONS);
  }, [ctx, roster, currentUserId]);

  /**
   * Splices `@Name ` over the in-progress token. Returns the new text plus the
   * caret position so the caller can restore focus/selection. Also registers
   * the mention so it is sent with the message.
   */
  const pick = useCallback(
    (candidate: MentionCandidate, text: string): { text: string; caret: number } | null => {
      if (!ctx) return null;
      const inserted = `@${candidate.name} `;
      const next = text.slice(0, ctx.start) + inserted + text.slice(ctx.start + 1 + ctx.query.length);
      registryRef.current.set(candidate.user_id, {
        user_id: candidate.user_id,
        name: candidate.name,
      });
      setCtx(null);
      return { text: next, caret: ctx.start + inserted.length };
    },
    [ctx],
  );

  /** Mentions still present in the final text, ready to send. */
  const resolveMentions = useCallback(
    (content: string) => resolveMentionsFromText(content, registryRef.current.values()),
    [],
  );

  /** Clears registered mentions after a successful send. */
  const reset = useCallback(() => {
    registryRef.current.clear();
    setCtx(null);
  }, []);

  // Dropping back to another community must not leak the previous registry.
  useEffect(() => {
    registryRef.current.clear();
    setCtx(null);
    setRoster([]);
  }, [communityId]);

  return {
    mentionOpen: ctx !== null,
    mentionQuery: ctx?.query ?? '',
    mentionOptions: options,
    onComposerActivity,
    pickMention: pick,
    resolveMentions,
    resetMentions: reset,
    closeMentions: close,
  };
}
