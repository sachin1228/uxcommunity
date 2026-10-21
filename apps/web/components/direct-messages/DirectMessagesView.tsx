"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { ImageLightbox, type LightboxImage } from "@/components/communities/chat/ImageLightbox";
import { MAX_MESSAGE_CHARS } from "@/components/communities/chat/chatUtils";
import { invalidateRequest, patchCachedRequest } from "@/lib/request-cache";
import { bumpConversationWithMessage } from "@/lib/direct-messages/client-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import {
  onConversationRead,
  markConversationRead,
  recordReadFloor,
  setActiveConversation,
} from "@/lib/direct-messages/read-manager";
import { newestRealMessage } from "@/lib/direct-messages/messages";
import type {
  DmConversationSummary,
  DmMessage,
  DmPreviewMessage,
  DmRequestState,
} from "@/lib/direct-messages/types";
import type { MessageDeletedByRole, ReplyPreview } from "@/lib/communities/cache";
import { DmListPane } from "./DmListPane";
import { DmReportModal } from "./DmReportModal";
import { DmThread, type DmFooterAction } from "./DmThread";
import { useDmConversations } from "./hooks/useDmConversations";
import { useDmMessageListAnchor } from "./hooks/useDmMessageListAnchor";
import { useDmReactions } from "./hooks/useDmReactions";
import { useDmRealtime } from "./hooks/useDmRealtime";
import { useDmScrollAndUnread } from "./hooks/useDmScrollAndUnread";
import { useDmSend } from "./hooks/useDmSend";
import { useDmThreadData } from "./hooks/useDmThreadData";
import { useDmTyping } from "./hooks/useDmTyping";

/** Narrow an API response's request state to the three states the app knows. */
function narrowRequestState(value: unknown): DmRequestState {
  return value === "pending" || value === "rejected" ? value : "accepted";
}
/**
 * Direct messages — the whole feature's client shell.
 *
 * Two panes: the conversation list and the open thread. One state owner (this
 * component) mirrors CommunityChat's structure: the data hooks paint cache
 * first, the single realtime subscription routes every event, and the thread
 * pane stays presentational. On narrow viewports the panes swap — list
 * first, thread with a back button.
 */
export function DirectMessagesView({
  userId,
  currentUserName,
  currentUserAvatar,
  initialConversation = null,
  limitNotice = null,
}: {
  userId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  /** The conversation a ?peer= handoff from a profile resolved to — opened on
   *  the first paint, before the list (which skips conversations with no
   *  messages) could carry it. */
  initialConversation?: DmConversationSummary | null;
  /** Why a ?peer= handoff didn't open — the monthly new-conversation cap
   *  refused it. Shown beside the empty pane's copy. */
  limitNotice?: string | null;
}) {
  const { conversations, setConversations, refresh } = useDmConversations({ userId });

  const [activeId, setActiveId] = useState<string | null>(initialConversation?.id ?? null);
  const [pendingConversation, setPendingConversation] = useState<DmConversationSummary | null>(
    initialConversation,
  );
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [editingInput, setEditingInput] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [actionPending, setActionPending] = useState<DmFooterAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeConversation = useMemo(
    () =>
      (conversations ?? []).find((c) => c.id === activeId) ??
      (pendingConversation?.id === activeId ? pendingConversation : null),
    [conversations, activeId, pendingConversation],
  );

  // The read marker frozen at open: the divider and unread count describe the
  // conversation as it was when the thread was opened, even if the marker
  // advances while the member reads (read-manager) — exactly like the
  // community chat's lastReadAtOnOpen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const myLastReadAtAtOpen = useMemo(() => activeConversation?.my_last_read_at ?? null, [activeId]);

  const conversationsRef = useRef<DmConversationSummary[] | null>(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // The ?peer= handoff has been flushed into state (initialConversation);
  // strip it from the URL so a refresh lands on the plain window and a later
  // Message click for the same member navigates afresh.
  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState(window.history.state, "", "/dashboard/messages");
    }
  }, []);

  // ── Data + behaviour hooks ────────────────────────────────────────────────
  const thread = useDmThreadData({ conversationId: activeId, userId });
  const setThreadMessages = thread.setMessages;
  const typing = useDmTyping({ activeConversationId: activeId, currentUserId: userId });
  const reactions = useDmReactions({
    conversationId: activeId,
    currentUserId: userId,
    setMessages: setThreadMessages,
    setConversations,
  });
  const scroll = useDmScrollAndUnread({
    conversationId: activeId,
    currentUserId: userId,
    messages: thread.messages,
    loading: thread.loading,
    initialMessagesReady: thread.initialReady,
    myLastReadAtAtOpen,
  });
  const {
    bottomRef,
    scrollContainerRef,
    unreadDividerRef,
    showScrollToBottom,
    firstUnreadMsgId,
    unreadDisplayCount,
    initialPositionResolved,
    setHideUnreadDivider,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
  } = scroll;
  // Load-older trigger + prepend compensation (mirrors the community list).
  const { topSentinelRef } = useDmMessageListAnchor({
    conversationId: activeId,
    messages: thread.messages,
    hasMoreAbove: thread.hasMoreAbove,
    loadingOlder: thread.loadingOlder,
    loading: thread.loading,
    fetchOlderMessages: thread.fetchOlderMessages,
    scrollContainerRef,
    initialPositionResolved,
  });

  // ── Conversation-list preview bumps for own sends ────────────────────────
  const previewRollbacksRef = useRef(new Map<string, DmConversationSummary[] | null>());

  const handlePreview = useCallback(
    (conversationId: string, tempId: string, preview: DmPreviewMessage) => {
      previewRollbacksRef.current.set(tempId, conversationsRef.current);
      setConversations((prev) =>
        bumpConversationWithMessage(prev, {
          conversationId,
          viewerId: userId,
          message: preview,
          activelyReading: true,
        }),
      );
    },
    [setConversations, userId],
  );

  const handlePreviewConfirmed = useCallback(
    (conversationId: string, tempId: string, preview: DmPreviewMessage) => {
      previewRollbacksRef.current.delete(tempId);
      setConversations((prev) => {
        const index = prev.findIndex((c) => c.id === conversationId);
        if (index === -1) return prev;
        const current = prev[index];
        if (current.last_message?.id !== tempId && current.last_message?.id !== preview.id) {
          return prev;
        }
        const next = prev.slice();
        next[index] = {
          ...current,
          last_message: preview,
          last_message_at: preview.created_at,
        };
        return next;
      });
    },
    [setConversations],
  );

  const handlePreviewFailed = useCallback(
    (conversationId: string, tempId: string) => {
      const snapshot = previewRollbacksRef.current.get(tempId);
      previewRollbacksRef.current.delete(tempId);
      if (!snapshot) return;
      const snapshotConversation = snapshot.find((c) => c.id === conversationId) ?? null;
      if (!snapshotConversation) return;
      setConversations((prev) => {
        const current = prev.find((c) => c.id === conversationId);
        // Only restore when the failed send is still the newest preview —
        // never clobber a message that arrived after it.
        if (!current || current.last_message?.id !== tempId) return prev;
        return prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                last_message: snapshotConversation.last_message,
                last_message_at: snapshotConversation.last_message_at,
              }
            : c,
        );
      });
    },
    [setConversations],
  );

  // ── Request / block lifecycle ─────────────────────────────────────────────
  /**
   * Patch one conversation's summary everywhere it can be read from: the
   * list state (drives the pane) and the ?peer= / open-thread fallback copy —
   * a list refetch drops blocked and rejected rows from the server payload,
   * and the thread must not vanish under the member while they decide.
   */
  const patchActiveConversation = useCallback(
    (conversationId: string, patch: Partial<DmConversationSummary>) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
      );
      setPendingConversation((prev) =>
        prev && prev.id === conversationId ? { ...prev, ...patch } : prev,
      );
    },
    [setConversations],
  );

  /** Run one footer action with shared busy/error handling. */
  const runFooterAction = useCallback(
    async (action: Exclude<DmFooterAction, null>, run: () => Promise<Response>) => {
      setActionPending(action);
      setActionError(null);
      try {
        const response = await run();
        const payload = (await response.json().catch(() => null)) as
          | Record<string, unknown>
          | null;
        if (!response.ok) {
          setActionError(
            typeof payload?.error === "string" ? payload.error : "Something went wrong.",
          );
          return null;
        }
        return payload;
      } catch {
        setActionError("Network error. Please try again.");
        return null;
      } finally {
        setActionPending(null);
      }
    },
    [],
  );

  const handleAcceptRequest = useCallback(async () => {
    const id = activeId;
    if (!id) return;
    const payload = await runFooterAction("accept", () =>
      fetch(dmUrls.conversationRequest(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
    );
    if (!payload) return;
    patchActiveConversation(id, {
      request_state: narrowRequestState(payload.request_state),
      requested_by: typeof payload.requested_by === "string" ? payload.requested_by : null,
    });
  }, [activeId, runFooterAction, patchActiveConversation]);

  const handleRejectRequest = useCallback(async () => {
    const id = activeId;
    if (!id) return;
    const payload = await runFooterAction("reject", () =>
      fetch(dmUrls.conversationRequest(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      }),
    );
    if (!payload) return;
    patchActiveConversation(id, {
      request_state: narrowRequestState(payload.request_state),
      requested_by: typeof payload.requested_by === "string" ? payload.requested_by : null,
    });
  }, [activeId, runFooterAction, patchActiveConversation]);

  const handleBlock = useCallback(async () => {
    const id = activeId;
    const peer = activeConversation?.peer;
    if (!id || !peer) return;
    const payload = await runFooterAction("block", () =>
      fetch(dmUrls.blocks, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: peer.id }),
      }),
    );
    if (!payload) return;
    // The thread's blocked bar (with its Unblock button) is the feedback and
    // the way back — no toast.
    patchActiveConversation(id, { blocked_by_me: true });
  }, [activeId, activeConversation, runFooterAction, patchActiveConversation]);

  const handleUnblock = useCallback(async () => {
    const id = activeId;
    const peer = activeConversation?.peer;
    if (!id || !peer) return;
    const payload = await runFooterAction("unblock", () =>
      fetch(`${dmUrls.blocks}?user_id=${peer.id}`, { method: "DELETE" }),
    );
    if (!payload) return;
    patchActiveConversation(id, { blocked_by_me: false });
    void refresh(true);
  }, [activeId, activeConversation, runFooterAction, patchActiveConversation, refresh]);

  /** A send response carries the conversation's post-send request state. */
  const handleConversationState = useCallback(
    (conversationId: string, requestState: DmRequestState, requestedBy: string | null) => {
      patchActiveConversation(conversationId, {
        request_state: requestState,
        requested_by: requestedBy,
      });
    },
    [patchActiveConversation],
  );

  const send = useDmSend({
    conversationId: activeId,
    currentUserId: userId,
    currentUserName,
    currentUserAvatar,
    setMessages: setThreadMessages,
    setHideUnreadDivider,
    replyTo,
    onClearReply: () => setReplyTo(null),
    scrollContainerRef,
    onPreview: handlePreview,
    onPreviewConfirmed: handlePreviewConfirmed,
    onPreviewFailed: handlePreviewFailed,
    onConversationState: handleConversationState,
  });
  const {
    input: sendInput,
    setInput: setSendInput,
    error: sendError,
    handleSend,
    handleKeyDown,
    handleCancelSend,
    handleRetrySend,
    handleGifSend,
    inputRef: sendInputRef,
    pendingImagePreview,
    handleImageSelect,
    handleImageClear,
  } = send;

  // The open thread's messages, read by the realtime hook to caption a
  // reaction preview (the reacted message's body is not in the list payload).
  const threadMessagesRef = useRef<DmMessage[]>([]);
  useEffect(() => {
    threadMessagesRef.current = thread.messages;
  }, [thread.messages]);

  // ── Realtime (one subscription for every conversation) ────────────────────
  useDmRealtime({
    userId,
    activeConversationIdRef: activeIdRef,
    conversationsRef,
    threadMessagesRef,
    setConversations,
    refreshConversations: refresh,
    setMessages: setThreadMessages,
    scrollContainerRef,
    initialScrollDoneRef,
    realtimeInsertPendingRef,
    realtimeWasNearBottomRef,
    fetchActiveCatchUp: thread.fetchMessages,
    onTypingEvent: typing.applyEvent,
    onTypingCleared: typing.clearUser,
  });

  // ── Read marker: open/close + badge invalidation ──────────────────────────
  useEffect(() => {
    setActiveConversation(activeId);
    return () => setActiveConversation(null);
  }, [activeId]);

  // Opening a conversation clears its row immediately — the community sidebar
  // zeroes on open and only then confirms with the server. Waiting for the
  // PATCH left the badge lit for the whole round trip, and any list refresh
  // that raced it put the old count straight back. The read floor records what
  // this open has acknowledged so a stale payload cannot bring the count back,
  // and the cached list is patched so a refetch inside the stale window
  // doesn't replay the pre-read payload either.
  useEffect(() => {
    if (!activeId) return;
    const opened = conversationsRef.current?.find((c) => c.id === activeId);
    if (opened?.last_message_at) recordReadFloor(activeId, opened.last_message_at);

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId && c.unread_count !== 0 ? { ...c, unread_count: 0 } : c,
      ),
    );
    patchCachedRequest<{ conversations?: DmConversationSummary[] }>(
      dmUrls.conversations,
      (current) => ({
        ...current,
        conversations: (current?.conversations ?? []).map((c) =>
          c.id === activeId ? { ...c, unread_count: 0 } : c,
        ),
      }),
      userId,
    );
  }, [activeId, setConversations, userId]);

  // Report the conversation read once its messages are on screen — up to the
  // newest DISPLAYED message, because "now" could swallow one that raced the
  // request. Re-arms whenever that newest timestamp advances, so a first mark
  // made from a partly-loaded page can never wedge the marker; the read
  // manager debounces and cools down the follow-up requests.
  const markedThroughRef = useRef<{ conversationId: string | null; through: number }>({
    conversationId: null,
    through: 0,
  });
  useEffect(() => {
    if (!activeId || !thread.initialReady) return;
    const newest = newestRealMessage(thread.messages);
    if (!newest) return;
    const through = new Date(newest.created_at).getTime();
    const marked = markedThroughRef.current;
    if (marked.conversationId === activeId && through <= marked.through) return;
    const isFirstMarkThisOpen = marked.conversationId !== activeId;
    markedThroughRef.current = { conversationId: activeId, through };
    markConversationRead(activeId, {
      immediate: isFirstMarkThisOpen,
      lastReadAt: newest.created_at,
    });
  }, [activeId, thread.initialReady, thread.messages]);

  useEffect(() => {
    return onConversationRead((conversationId, markedAt) => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conversationId) return c;
          // The server's effective marker is authoritative, but a slower
          // in-flight response must not regress what the list displays.
          if (
            c.my_last_read_at &&
            new Date(c.my_last_read_at).getTime() >= new Date(markedAt).getTime()
          ) {
            return c;
          }
          return { ...c, unread_count: 0, my_last_read_at: markedAt };
        }),
      );
      // Mirror the cleared row into the cached list too: a refetch within the
      // stale window must not replay the pre-read unread count (the community
      // sidebar patches its store for the same reason).
      patchCachedRequest<{ conversations?: DmConversationSummary[] }>(
        dmUrls.conversations,
        (current) => ({
          ...current,
          conversations: (current?.conversations ?? []).map((c) =>
            c.id === conversationId
              ? c.my_last_read_at &&
                new Date(c.my_last_read_at).getTime() >= new Date(markedAt).getTime()
                ? c
                : { ...c, unread_count: 0, my_last_read_at: markedAt }
              : c,
          ),
        }),
        userId,
      );
      invalidateRequest(dmUrls.unread, userId);
    });
  }, [setConversations, userId]);

  // ── Opening a conversation ────────────────────────────────────────────────
  const openConversation = useCallback((conversationId: string) => {
    setActiveId(conversationId);
    setActionError(null);
    // Seed the fallback copy with what the list knows: once a refetch drops
    // the row (blocked / rejected conversations leave the server payload),
    // this copy is what keeps the thread on screen. The ?peer= handoff's own
    // conversation stays as-is.
    const summary = conversationsRef.current?.find((c) => c.id === conversationId) ?? null;
    setPendingConversation((prev) => {
      if (summary) return summary;
      return prev && prev.id === conversationId ? prev : null;
    });
    setLightboxIndex(null);
  }, []);

  // Leaving the thread drops it and any lifecycle error that belonged to it.
  const closeConversation = useCallback(() => {
    setActiveId(null);
    setActionError(null);
  }, []);

  // The window has no dashboard sidebar; the list heading's back arrow is the
  // exit — plain history back, so it returns to whichever surface (profile,
  // feed, sidebar) opened the window.
  const handleBack = useCallback(() => {
    window.history.back();
  }, []);

  // ── Message actions ───────────────────────────────────────────────────────
  const focusComposer = useCallback(() => {
    setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>("[data-chat-input]")?.focus();
    }, 50);
  }, []);

  const handleReply = useCallback(
    (msg: DmMessage) => {
      setReplyTo({
        id: msg.id,
        content: msg.content || (msg.image_url ? "📷 Image" : ""),
        user_name: msg.users?.name ?? "Unknown",
        user_id: msg.user_id,
      });
      focusComposer();
    },
    [focusComposer],
  );

  const handleCopy = useCallback((msg: DmMessage) => {
    navigator.clipboard.writeText(msg.content).catch(() => {});
  }, []);

  const handleEdit = useCallback(
    (msg: DmMessage) => {
      setEditingMessage(msg);
      setEditingInput(msg.content);
      setEditingError(null);
      setReplyTo(null);
    },
    [],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setEditingInput("");
    setEditingError(null);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingMessage || editingSaving) return;
    const content = editingInput.trim();
    if (!content) {
      setEditingError("Message cannot be empty.");
      return;
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      setEditingError(`Message is too long (max ${MAX_MESSAGE_CHARS} characters).`);
      return;
    }
    const messageId = editingMessage.id;
    const originalContent = editingMessage.content;
    setEditingSaving(true);
    setEditingError(null);

    setThreadMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content } : m)),
    );
    setConversations((prev) =>
      prev.map((c) =>
        c.last_message?.id === messageId
          ? { ...c, last_message: { ...c.last_message, content } }
          : c,
      ),
    );

    try {
      const res = await fetch(dmUrls.message(messageId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        content?: string;
        edited_at?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to edit message.");
      setThreadMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: data.content ?? content, edited_at: data.edited_at ?? new Date().toISOString() }
            : m,
        ),
      );
      setEditingMessage(null);
      setEditingInput("");
    } catch (error) {
      setThreadMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: originalContent } : m)),
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.last_message?.id === messageId
            ? { ...c, last_message: { ...c.last_message, content: originalContent } }
            : c,
        ),
      );
      setEditingError(error instanceof Error ? error.message : "Failed to edit message.");
    } finally {
      setEditingSaving(false);
    }
  }, [editingMessage, editingSaving, editingInput, setThreadMessages, setConversations]);

  const handleDelete = useCallback(
    async (msgId: string, _removedByRole: MessageDeletedByRole | null) => {
      let previousMessage: DmMessage | null = null;
      setThreadMessages((prev) => {
        previousMessage = prev.find((m) => m.id === msgId) ?? null;
        return prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                deleted_at: new Date().toISOString(),
                deleted_by: userId,
                deleted_by_role: null,
                content: "",
                image_url: null,
                reply_to: null,
                reactions: [],
              }
            : m,
        );
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.last_message?.id === msgId
            ? { ...c, last_message: { ...c.last_message, content: null, image_url: null, deleted_at: new Date().toISOString() } }
            : c,
        ),
      );

      try {
        const res = await fetch(dmUrls.message(msgId), { method: "DELETE" });
        if (!res.ok) throw new Error("delete failed");
      } catch {
        // Restore the pre-delete row directly (a refetch could return a stale
        // snapshot that dropped newer messages).
        setThreadMessages((prev) =>
          previousMessage ? prev.map((m) => (m.id === msgId ? previousMessage! : m)) : prev,
        );
      }
    },
    [setThreadMessages, setConversations, userId],
  );

  // ── Row focus flash (reply jumps) ─────────────────────────────────────────
  const flashMessage = useCallback(
    (messageId: string, durationMs: number): boolean => {
      const el = scrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${messageId}"]`,
      );
      if (!el) return false;
      el.scrollIntoView({ behavior: "instant", block: "center" });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedMsgId(messageId);
      highlightTimerRef.current = setTimeout(() => setHighlightedMsgId(null), durationMs);
      return true;
    },
    [scrollContainerRef],
  );

  const handleReplyClick = useCallback(
    (replyId: string) => {
      flashMessage(replyId, 1500);
    },
    [flashMessage],
  );

  // ── Image lightbox ────────────────────────────────────────────────────────
  const chatImages = useMemo<LightboxImage[]>(
    () =>
      thread.messages
        .filter((m) => m.image_url && !m.deleted_at)
        .map((m) => ({
          url: m.image_url!,
          content: m.content || null,
          user_name: m.users?.name ?? null,
          avatar_url: m.users?.avatar_url ?? null,
          created_at: m.created_at,
        })),
    [thread.messages],
  );
  const chatImagesRef = useRef(chatImages);
  useEffect(() => {
    chatImagesRef.current = chatImages;
  }, [chatImages]);

  const handleImageClick = useCallback((url: string) => {
    const index = chatImagesRef.current.findIndex((img) => img.url === url);
    if (index >= 0) setLightboxIndex(index);
  }, []);

  // ── Composer wiring ───────────────────────────────────────────────────────
  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      const textarea = sendInputRef.current;
      if (textarea) {
        const start = textarea.selectionStart ?? sendInput.length;
        const end = textarea.selectionEnd ?? sendInput.length;
        const next = sendInput.slice(0, start) + emoji + sendInput.slice(end);
        setSendInput(next);
        typing.setTyping(true);
        requestAnimationFrame(() => {
          textarea.selectionStart = start + emoji.length;
          textarea.selectionEnd = start + emoji.length;
          textarea.focus();
        });
      } else {
        setSendInput((prev) => prev + emoji);
      }
    },
    [sendInput, sendInputRef, setSendInput, typing],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setSendInput(value);
      typing.setTyping(value.trim().length > 0);
    },
    [setSendInput, typing],
  );

  const handleInputSend = useCallback(() => {
    typing.setTyping(false);
    void handleSend();
  }, [handleSend, typing]);

  const handleInputBlur = useCallback(() => {
    typing.setTyping(false);
  }, [typing]);

  // ── Composer growth must not push the newest message out of view ──────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let prevDist = container.scrollHeight - container.scrollTop - container.clientHeight;
    const onScroll = () => {
      prevDist = container.scrollHeight - container.scrollTop - container.clientHeight;
    };
    const observer = new ResizeObserver(() => {
      if (prevDist <= 10) {
        container.scrollTop = container.scrollHeight - container.clientHeight;
      }
      prevDist = container.scrollHeight - container.scrollTop - container.clientHeight;
    });
    container.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [scrollContainerRef, activeId]);

  // ── Per-conversation drafts ───────────────────────────────────────────────
  const draftsRef = useRef(new Map<string, { input: string; replyTo: ReplyPreview | null }>());
  const latestInputRef = useRef("");
  useEffect(() => {
    latestInputRef.current = sendInput;
  }, [sendInput]);
  const setInputWithDraft = useCallback(
    (value: React.SetStateAction<string>) => {
      setSendInput(value);
      const key = activeIdRef.current;
      if (!key) return;
      const nextInput =
        typeof value === "function" ? (value as (prev: string) => string)(latestInputRef.current) : value;
      draftsRef.current.set(key, { input: nextInput, replyTo });
    },
    [setSendInput, replyTo],
  );
  useEffect(() => {
    if (!activeId) return;
    const saved = draftsRef.current.get(activeId);
    setSendInput(saved?.input ?? "");
    setReplyTo(saved?.replyTo ?? null);
    setEditingMessage(null);
    setEditingInput("");
    if (sendInputRef.current) sendInputRef.current.style.height = "24px";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const hasConversations = (conversations ?? []).length > 0;

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0">
      <DmListPane
        conversations={conversations}
        activeId={activeId}
        currentUserId={userId}
        loading={conversations === null}
        typingByConversation={typing.typingByConversation}
        onSelect={openConversation}
        onBack={handleBack}
        className={activeId ? "hidden min-[500px]:flex" : "flex"}
      />

      <div className={`${activeId ? "flex" : "hidden min-[500px]:flex"} min-h-0 min-w-0 flex-1`}>
        {activeConversation ? (
          <DmThread
            conversation={activeConversation}
            currentUserId={userId}
            messages={thread.messages}
            loading={thread.loading}
            loadingOlder={thread.loadingOlder}
            hasMoreAbove={thread.hasMoreAbove}
            initialPositionResolved={initialPositionResolved}
            scrollContainerRef={scrollContainerRef}
            topSentinelRef={topSentinelRef}
            bottomRef={bottomRef}
            unreadDividerRef={unreadDividerRef}
            showScrollToBottom={showScrollToBottom}
            firstUnreadMsgId={firstUnreadMsgId}
            unreadDisplayCount={unreadDisplayCount}
            highlightedMsgId={highlightedMsgId}
            typingUsers={typing.typingUsers}
            input={sendInput}
            error={sendError}
            sending={editingSaving}
            inputRef={sendInputRef}
            replyTo={replyTo}
            pendingImagePreview={pendingImagePreview}
            editingMessage={editingMessage}
            editingSaving={editingSaving}
            editingInput={editingInput}
            editingError={editingError}
            onBack={closeConversation}
            onInputChange={handleInputChange}
            onInputKeyDown={handleKeyDown}
            onInputSend={handleInputSend}
            onInputBlur={handleInputBlur}
            onCancelReply={() => setReplyTo(null)}
            onImageSelect={handleImageSelect}
            onImageRemove={handleImageClear}
            onEmojiSelect={handleEmojiSelect}
            onGifSelect={(url) => void handleGifSend(url)}
            onCancelSend={handleCancelSend}
            onRetrySend={(msgId) => void handleRetrySend(msgId)}
            onReaction={reactions.handleReaction}
            onReply={handleReply}
            onEdit={handleEdit}
            onCopy={handleCopy}
            onDelete={(msgId, role) => void handleDelete(msgId, role)}
            onImageClick={handleImageClick}
            onReplyClick={handleReplyClick}
            onEditInputChange={setEditingInput}
            onEditSave={() => void handleEditSave()}
            onEditClose={handleCancelEdit}
            onReport={() => setReportOpen(true)}
            onBlock={() => void handleBlock()}
            onUnblock={() => void handleUnblock()}
            onAcceptRequest={() => void handleAcceptRequest()}
            onRejectRequest={() => void handleRejectRequest()}
            actionPending={actionPending}
            actionError={actionError}
          />
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Send size={32} strokeWidth={1.75} className="text-foreground-muted/50" />
            <p className="font-body text-sm text-foreground-muted">
              {hasConversations
                ? "Select a conversation."
                : "Message anyone in the community — privately."}
            </p>
            {!hasConversations && (
              <p className="font-body text-xs text-foreground-muted/70">
                Open a profile to start.
              </p>
            )}
            {limitNotice && (
              <p className="max-w-xs font-body text-xs text-red-400">{limitNotice}</p>
            )}
          </div>
        )}
      </div>

      {lightboxIndex !== null && chatImages[lightboxIndex] && (
        <ImageLightbox
          images={chatImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(index) => setLightboxIndex(index)}
        />
      )}

      {activeConversation && (
        <DmReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          conversationId={activeConversation.id}
          peerName={activeConversation.peer.name}
        />
      )}
    </div>
  );
}
