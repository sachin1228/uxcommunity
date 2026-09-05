"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  detectMentionTrigger,
  resolveMentionsFromText,
} from "@/lib/communities/mentions";
import type {
  MentionCandidate,
  MessageMention,
} from "@/lib/communities/mentions";
import { fetchJsonCached } from "@/lib/request-cache";

/** Freshness window for the unfiltered member roster used by the popover. */
const ROSTER_STALE_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 180;
/** Max rows rendered (server caps each members page at 30 anyway). */
const MAX_OPTIONS = 30;

interface MembersPage {
  members?: MentionCandidate[];
}

// Module-level roster cache, shared across chat visits (like MembersView).
const rosterCache = new Map<
  string,
  { members: MentionCandidate[]; fetchedAt: number }
>();
const inflightRoster = new Map<string, Promise<void>>();

interface MentionContext {
  start: number;
  query: string;
}

interface UseMemberMentionsOptions {
  communityId: string;
  currentUserId: string;
  /** Commits a new composer value (mention inserted) and restores the caret. */
  onCommitText: (text: string, caret: number) => void;
}

/** The single chat composer (data-chat-input) — only one is ever mounted. */
function composerTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>("[data-chat-input]");
}

function rosterKey(communityId: string, currentUserId: string) {
  return `${currentUserId}:${communityId}`;
}

export function useMemberMentions({
  communityId,
  currentUserId,
  onCommitText,
}: UseMemberMentionsOptions) {
  const [ctx, setCtx] = useState<MentionContext | null>(null);
  const [options, setOptions] = useState<MentionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  /** Mentions the composer has registered by *picking* them from the popover. */
  const registryRef = useRef<Map<string, MessageMention>>(new Map());
  const scopeRef = useRef({ communityId, currentUserId });
  const ctxRef = useRef<MentionContext | null>(null);
  const ctxTokenRef = useRef<string>("");
  const seqRef = useRef(0);

  const isOpen = ctx !== null;

  // Keep the ref in sync for stable callbacks + stale-async guards.
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  /**
   * Events are the only place state may be (re)created, so if this instance is
   * ever reused for another community/user the registry + popover must reset
   * the moment the first event for the new scope arrives. Guarded async work
   * is dropped by the seq/token checks below.
   */
  const resetForScopeChange = useCallback(() => {
    if (
      scopeRef.current.communityId === communityId &&
      scopeRef.current.currentUserId === currentUserId
    ) {
      return;
    }
    scopeRef.current = { communityId, currentUserId };
    registryRef.current = new Map();
    ctxRef.current = null;
    ctxTokenRef.current = "";
    seqRef.current += 1;
    setCtx(null);
    setOptions([]);
    setLoading(false);
    setActiveIndex(0);
  }, [communityId, currentUserId]);  const ensureRoster = useCallback(async (): Promise<MentionCandidate[]> => {
    const key = rosterKey(communityId, currentUserId);
    const cached = rosterCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ROSTER_STALE_MS) {
      return cached.members;
    }
    const inflight = inflightRoster.get(key);
    if (inflight) {
      await inflight;
      return rosterCache.get(key)?.members ?? [];
    }
    const p = fetchJsonCached<MembersPage>(
      `/api/communities/${communityId}/members?page=0`,
      { staleMs: ROSTER_STALE_MS },
      currentUserId,
    )
      .then((data) => {
        rosterCache.set(key, {
          members: data?.members ?? [],
          fetchedAt: Date.now(),
        });
      })
      .catch(() => {
        // Keep whatever cache entry exists; the popover falls back to search.
      });
    inflightRoster.set(key, p);
    void p.finally(() => inflightRoster.delete(key));
    await p;
    return rosterCache.get(key)?.members ?? [];
  }, [communityId, currentUserId]);

  const localMatches = useCallback(
    (query: string): MentionCandidate[] => {
      const roster = rosterCache.get(rosterKey(communityId, currentUserId))?.members;
      if (!roster?.length) return [];
      const q = query.trim().toLowerCase();
      if (!q) return roster.slice(0, MAX_OPTIONS);
      return roster
        .filter((member) => member.name.toLowerCase().includes(q))
        .slice(0, MAX_OPTIONS);
    },
    [communityId, currentUserId],
  );

  /**
   * Re-evaluates whether the caret sits at the end of an `@query` token.
   * Called on every textarea activity (typing, caret moves, pastes, clicks).
   * Options that can be answered from the cached roster are applied right
   * here (event context), so the popover never waits for an effect.
   */
  const syncFromTextarea = useCallback(
    (value: string, caret: number) => {
      resetForScopeChange();
      const next = detectMentionTrigger(value, caret);
      const token = next ? `${next.start}|${next.query}` : "";
      if (token === ctxTokenRef.current) return;
      seqRef.current += 1;
      ctxTokenRef.current = token;
      if (!next) {
        ctxRef.current = null;
        setCtx(null);
        setOptions([]);
        setLoading(false);
        setActiveIndex(0);
        return;
      }
      ctxRef.current = next;
      setCtx(next);
      setActiveIndex(0);
      const fromRoster = localMatches(next.query);
      if (fromRoster.length) {
        setOptions(fromRoster);
        setLoading(false);
      } else {
        // Keep the previous list visible while the search is pending rather
        // than flashing an empty popover for every keystroke.
        setOptions([]);
        setLoading(!next.query ? true : fromRoster.length === 0);
      }
    },
    [localMatches, resetForScopeChange],
  );

  // ── Async data for the current context (roster fetch / server search) ─────
  useEffect(() => {
    if (!ctx) return;
    const { query } = ctx;
    const seq = seqRef.current;
    const token = ctxTokenRef.current;

    if (!query) {
      // Roster already shown synchronously from cache; fetch it once per 60s.
      const key = rosterKey(communityId, currentUserId);
      if (rosterCache.get(key)?.members?.length) return;
      void ensureRoster()
        .then((members) => {
          if (seq !== seqRef.current || token !== ctxTokenRef.current) return;
          setOptions(members.slice(0, MAX_OPTIONS));
          setLoading(false);
        })
        .catch(() => setLoading(false));
      return;
    }

    // Typed query — let the server-side search (covers the whole membership,
    // not just page one of the roster) replace the local matches.
    const timer = window.setTimeout(() => {
      fetch(
        `/api/communities/${communityId}/members?search=${encodeURIComponent(
          query.trim().toLowerCase(),
        )}&page=0`,
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((data: MembersPage | null) => {
          if (seq !== seqRef.current || token !== ctxTokenRef.current) return;
          const fresh = (data?.members ?? []).slice(0, MAX_OPTIONS);
          setOptions(fresh);
          setLoading(false);
          setActiveIndex((prev) => Math.min(prev, Math.max(fresh.length - 1, 0)));
        })
        .catch(() => {
          if (seq === seqRef.current && token === ctxTokenRef.current) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [ctx, communityId, currentUserId, ensureRoster]);

  // ── Selection ──────────────────────────────────────────────────────────────
  /**
   * Dismisses the popover (blur, Esc, send, tab switch). Bumps the seq so an
   * in-flight roster/search response can't repopulate a closed popover, and
   * remembers the current token as "dismissed": syncFromTextarea only reopens
   * when the trigger text actually changes, so the keyup/click re-sync that
   * follows Esc/blur can't instantly resurrect the popover. Typing more of the
   * name, deleting back into the @, or starting a new @ reopens it.
   */
  const close = useCallback(() => {
    resetForScopeChange();
    // Nothing is open — bail so callers that run from effects (tab switch,
    // blur, send) can't set fresh [] identities and re-trigger themselves in
    // an update loop via the memoized API object.
    if (ctxRef.current === null) return;
    seqRef.current += 1;
    ctxRef.current = null;
    setCtx(null);
    setOptions([]);
    setLoading(false);
    setActiveIndex(0);
  }, [resetForScopeChange]);

  const pick = useCallback(
    (candidate: MentionCandidate) => {
      resetForScopeChange();
      const context = ctxRef.current;
      const textarea = composerTextarea();
      // Trim: legacy member names may carry stray whitespace.
      const name = candidate?.name?.trim();
      if (!context || !textarea || !name) return;

      const value = textarea.value;
      // Replace exactly the typed "@query" token (ctx was computed from this
      // same value + caret; clamp defensively).
      const caret = textarea.selectionStart ?? value.length;
      const end = Math.min(Math.max(caret, context.start), value.length);
      const start = Math.min(context.start, end);

      const insertion = `@${name} `;
      const next = value.slice(0, start) + insertion + value.slice(end);
      registryRef.current.set(name.toLowerCase(), {
        user_id: candidate.user_id,
        name,
      });
      close();
      onCommitText(next, start + insertion.length);
    },
    [close, onCommitText, resetForScopeChange],
  );

  const move = useCallback((delta: -1 | 1) => {
    setActiveIndex((prev) => {
      const count = options.length;
      if (count === 0) return 0;
      return (prev + delta + count) % count;
    });
  }, [options.length]);

  const hover = useCallback((index: number) => {
    setActiveIndex((prev) => {
      const count = options.length;
      if (count === 0) return 0;
      return Math.min(Math.max(index, 0), count - 1);
    });
  }, [options.length]);

  /**
   * Picks the active option. Returns true when a mention was inserted (the
   * caller should swallow the Enter key), false when the popover has nothing
   * to pick (caller may close the popover instead of sending).
   */
  const selectActive = useCallback((): boolean => {
    if (options.length === 0) return false;
    const candidate = options[activeIndex] ?? options[0];
    if (!candidate) return false;
    pick(candidate);
    return true;
  }, [activeIndex, options, pick]);

  const resolveMentionsForContent = useCallback(
    (content: string): MessageMention[] =>
      resolveMentionsFromText(content, registryRef.current.values()),
    [],
  );

  return useMemo(
    () => ({
      isOpen,
      loading,
      query: ctx?.query ?? "",
      options,
      activeIndex,
      syncFromTextarea,
      pick,
      move,
      hover,
      selectActive,
      close,
      resolveMentionsForContent,
    }),
    [
      isOpen,
      loading,
      ctx,
      options,
      activeIndex,
      syncFromTextarea,
      pick,
      move,
      hover,
      selectActive,
      close,
      resolveMentionsForContent,
    ],
  );
}
