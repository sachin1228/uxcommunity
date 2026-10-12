"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { MessageEditModal } from "@/components/communities/chat/MessageEditModal";
import { TypingIndicator } from "@/components/communities/chat/TypingIndicator";
import { ChatInput } from "@/components/communities/chat/ChatInput";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { profileHref } from "@/lib/profile/links";
import { DmMessageList } from "./DmMessageList";
import type { DmTypingUser } from "./hooks/useDmTyping";
import type { DmConversationSummary, DmMessage } from "@/lib/direct-messages/types";
import type { MessageDeletedByRole, ReplyPreview } from "@/lib/communities/cache";

/**
 * The open conversation's pane: identity header, message body, composer —
 * laid out exactly like the community room's chat pane (paper layer, static
 * footer, scroll-to-bottom pill) with the community room's extras (tabs,
 * watermark, @ pill) left out.
 */
export function DmThread({
  conversation,
  currentUserId,
  messages,
  loading,
  loadingOlder,
  hasMoreAbove,
  initialPositionResolved,
  scrollContainerRef,
  topSentinelRef,
  bottomRef,
  unreadDividerRef,
  showScrollToBottom,
  firstUnreadMsgId,
  unreadDisplayCount,
  highlightedMsgId,
  typingUsers,
  input,
  error,
  sending,
  inputRef,
  replyTo,
  pendingImagePreview,
  editingMessage,
  editingSaving,
  editingInput,
  editingError,
  onBack,
  onInputChange,
  onInputKeyDown,
  onInputSend,
  onInputBlur,
  onCancelReply,
  onImageSelect,
  onImageRemove,
  onEmojiSelect,
  onGifSelect,
  onCancelSend,
  onRetrySend,
  onReaction,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onImageClick,
  onReplyClick,
  onEditInputChange,
  onEditSave,
  onEditClose,
}: {
  conversation: DmConversationSummary;
  currentUserId: string;
  messages: DmMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasMoreAbove: boolean;
  initialPositionResolved: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  topSentinelRef: React.RefObject<HTMLDivElement>;
  bottomRef: React.RefObject<HTMLDivElement>;
  unreadDividerRef: React.RefObject<HTMLDivElement>;
  showScrollToBottom: boolean;
  firstUnreadMsgId: string | null;
  unreadDisplayCount: number;
  highlightedMsgId: string | null;
  typingUsers: DmTypingUser[];
  input: string;
  error: string | null;
  sending: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  replyTo: ReplyPreview | null;
  pendingImagePreview: string | null;
  editingMessage: DmMessage | null;
  editingSaving: boolean;
  editingInput: string;
  editingError: string | null;
  onBack: () => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onInputSend: () => void;
  onInputBlur: () => void;
  onCancelReply: () => void;
  onImageSelect: (file: File) => void;
  onImageRemove: () => void;
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
  onCancelSend: (msgId: string) => void;
  onRetrySend: (msgId: string) => void;
  onReaction: (msgId: string, emoji: string) => void;
  onReply: (msg: DmMessage) => void;
  onEdit: (msg: DmMessage) => void;
  onCopy: (msg: DmMessage) => void;
  onDelete: (msgId: string, removedByRole: MessageDeletedByRole | null) => void;
  onImageClick: (url: string) => void;
  onReplyClick: (replyId: string) => void;
  onEditInputChange: (value: string) => void;
  onEditSave: () => void;
  onEditClose: () => void;
}) {
  const peer = conversation.peer;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header — peer identity, back to the list on narrow viewports. */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground min-[500px]:hidden"
          aria-label="Back to conversations"
        >
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
        <Link
          href={profileHref(peer.id)}
          className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-surface-raised"
        >
          <AvatarImg url={peer.avatar_url} name={peer.name} size={36} className="shrink-0 rounded-full object-cover" />
          <span className="min-w-0 truncate font-body text-sm font-semibold text-foreground">
            {peer.name}
          </span>
        </Link>
      </header>

      {/* Message body — paper + scroller share one grid cell, like the
          community chat; the footer below is a plain flex sibling. */}
      <div className="relative grid min-h-0 flex-1 grid-rows-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-background"
          style={{
            backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          ref={scrollContainerRef}
          data-chat-scroll-container
          className="relative col-start-1 row-start-1 min-h-0 overflow-y-auto"
          style={{ overflowAnchor: "none" }}
        >
          <DmMessageList
            conversationId={conversation.id}
            messages={messages}
            peer={peer}
            currentUserId={currentUserId}
            firstUnreadMsgId={firstUnreadMsgId}
            unreadDisplayCount={unreadDisplayCount}
            unreadDividerRef={unreadDividerRef}
            topSentinelRef={topSentinelRef}
            bottomRef={bottomRef}
            initialPositionResolved={initialPositionResolved}
            loading={loading}
            loadingOlder={loadingOlder}
            hasMoreAbove={hasMoreAbove}
            highlightedMsgId={highlightedMsgId}
            onReplyClick={onReplyClick}
            onCancelSend={onCancelSend}
            onRetrySend={onRetrySend}
            onReaction={onReaction}
            onReply={onReply}
            onEdit={onEdit}
            onCopy={onCopy}
            onDelete={onDelete}
            onImageClick={onImageClick}
          />
        </div>
      </div>

      {/* Static footer — never overlapped by messages. */}
      <footer className="relative z-10 shrink-0 bg-background">
        {showScrollToBottom && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="absolute -top-10 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted shadow-lg transition-colors hover:text-foreground"
            aria-label="Scroll to bottom"
          >
            <ChevronDown strokeWidth={2.5} size={16} />
          </button>
        )}
        <TypingIndicator users={typingUsers} />
        <div>
          <ChatInput
            ref={inputRef}
            input={input}
            sending={sending}
            error={error}
            placeholder={`Message ${peer.name}`}
            replyTo={replyTo}
            pendingImagePreview={pendingImagePreview}
            linkPreviewUrl={input.trim() ? extractFirstUrl(input) : null}
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            onSend={onInputSend}
            onBlur={onInputBlur}
            onCancelReply={onCancelReply}
            onImageSelect={onImageSelect}
            onImageRemove={onImageRemove}
            onEmojiSelect={onEmojiSelect}
            onGifSelect={onGifSelect}
          />
        </div>
      </footer>

      {editingMessage && (
        <MessageEditModal
          message={editingMessage}
          input={editingInput}
          saving={editingSaving}
          error={editingError}
          onChange={onEditInputChange}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onEditSave();
            }
          }}
          onSave={onEditSave}
          onClose={onEditClose}
        />
      )}
    </div>
  );
}
