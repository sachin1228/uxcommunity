"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, SquarePen } from "lucide-react";
import { ImageLightbox, type LightboxImage } from "@/components/communities/chat/ImageLightbox";
import { MAX_MESSAGE_CHARS } from "@/components/communities/chat/chatUtils";
import { invalidateRequest } from "@/lib/request-cache";
import { bumpConversationWithMessage } from "@/lib/direct-messages/client-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import { onConversationRead, setActiveConversation } from "@/lib/direct-messages/read-manager";
import type {
  DmConversationSummary,
  DmMessage,
  DmPerson,
  DmPreviewMessage,
} from "@/lib/direct-messages/types";
import type { MessageDeletedByRole, ReplyPreview } from "@/lib/communities/cache";
import { DmListPane } from "./DmListPane";
import { DmNewMessageDialog } from "./DmNewMessageDialog";
import { DmThread } from "./DmThread";
import { useDmConversations } from "./hooks/useDmConversations";
import { useDmMessageListAnchor } from "./hooks/useDmMessageListAnchor";
import { useDmReactions } from "./hooks/useDmReactions";
import { useDmRealtime } from "./hooks/useDmRealtime";
import { useDmScrollAndUnread } from "./hooks/useDmScrollAndUnread";
import { useDmSend } from "./hooks/useDmSend";
import { useDmThreadData } from "./hooks/useDmThreadData";
import { useDmTyping } from "./hooks/useDmTyping";
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
}: {
  userId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
}) {
  const { conversations, setConversations, refresh } = useDmConversations({ userId });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingConversation, setPendingConversation] = useState<DmConversationSummary | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [editingInput, setEditingInput] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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

  // ── Data + behaviour hooks ────────────────────────────────────────────────
  const thread = useDmThreadData({ conversationId: activeId, userId });
  const setThreadMessages = thread.setMessages;
  const typing = useDmTyping({ activeConversationId: activeId, currentUserId: userId });
  const reactions = useDmReactions({
    conversationId: activeId,
    currentUserId: userId,
    setMessages: setThreadMessages,
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

  // ── Realtime (one subscription for every conversation) ────────────────────
  useDmRealtime({
    userId,
    activeConversationIdRef: activeIdRef,
    conversationsRef,
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

  useEffect(() => {
    return onConversationRead((conversationId, markedAt) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, unread_count: 0, my_last_read_at: markedAt }
            : c,
        ),
      );
      invalidateRequest(dmUrls.unread, userId);
    });
  }, [setConversations, userId]);

  // ── Opening a conversation / starting a new one ───────────────────────────
  const openConversation = useCallback((conversationId: string) => {
    setActiveId(conversationId);
    setPendingConversation((prev) => (prev && prev.id !== conversationId ? null : prev));
    setLightboxIndex(null);
  }, []);

  const handlePickPerson = useCallback(
    async (person: DmPerson) => {
      const existing = (conversationsRef.current ?? []).find((c) => c.peer.id === person.id);
      setNewDialogOpen(false);
      if (existing) {
        openConversation(existing.id);
        return;
      }
      try {
        const res = await fetch(dmUrls.conversations, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peer_user_id: person.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { conversation?: DmConversationSummary };
        if (!res.ok || !data.conversation) throw new Error("failed");
        setPendingConversation(data.conversation);
        openConversation(data.conversation.id);
      } catch {
        setNewDialogOpen(true);
      }
    },
    [openConversation],
  );

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
        onSelect={openConversation}
        onNewMessage={() => setNewDialogOpen(true)}
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
            onBack={() => setActiveId(null)}
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
          />
        ) : (
          <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquare size={32} strokeWidth={1.5} className="text-foreground-muted/50" aria-hidden />
            <p className="font-body text-sm text-foreground-muted">
              {hasConversations
                ? "Select a conversation or start a new one."
                : "Message anyone in the community — privately."}
            </p>
            <button
              type="button"
              onClick={() => setNewDialogOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-[var(--ds-blue-800)] px-4 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:bg-[var(--ds-blue-900)]"
            >
              <SquarePen size={13} strokeWidth={2.5} />
              New message
            </button>
          </div>
        )}
      </div>

      <DmNewMessageDialog
        open={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        onPick={(person) => void handlePickPerson(person)}
      />

      {lightboxIndex !== null && chatImages[lightboxIndex] && (
        <ImageLightbox
          images={chatImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(index) => setLightboxIndex(index)}
        />
      )}
    </div>
  );
}
