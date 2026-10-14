"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Ban, ChevronDown, ChevronLeft, Clock, Flag, MoreVertical, ShieldOff, XCircle } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { PendingButton } from "@/components/ui/PendingButton";
import { MessageEditModal } from "@/components/communities/chat/MessageEditModal";
import { TypingIndicator } from "@/components/communities/chat/TypingIndicator";
import { ChatInput } from "@/components/communities/chat/ChatInput";
import { extractFirstUrl } from "@/lib/communities/linkPreview";
import { profileHref } from "@/lib/profile/links";
import { DmMessageList } from "./DmMessageList";
import type { DmTypingUser } from "./hooks/useDmTyping";
import type { DmConversationSummary, DmMessage } from "@/lib/direct-messages/types";
import type { MessageDeletedByRole, ReplyPreview } from "@/lib/communities/cache";

/** Which footer action is in flight — its button spins, the rest disable. */
export type DmFooterAction = "accept" | "reject" | "block" | "unblock" | null;

/**
 * The open conversation's pane: identity header (with the ⋯ menu: Report /
 * Block), message body, composer — laid out exactly like the community
 * room's chat pane (paper layer, static footer, scroll-to-bottom pill) with
 * the community room's extras (tabs, watermark, @ pill) left out.
 *
 * The footer is a small state machine over the conversation's lifecycle:
 * a pending request shows Accept/Reject to its recipient and a waiting note
 * to its sender, a rejected one says so, and a blocked peer shows the block
 * with the way back. Only an ordinary, accepted conversation gets the
 * composer.
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
  onReport,
  onBlock,
  onUnblock,
  onAcceptRequest,
  onRejectRequest,
  actionPending,
  actionError,
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
  /** Opens the report modal for this conversation's peer. */
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onAcceptRequest: () => void;
  onRejectRequest: () => void;
  /** The in-flight footer action, or null. */
  actionPending: DmFooterAction;
  /** The last footer action's error, shown under its bar. */
  actionError: string | null;
}) {
  const peer = conversation.peer;

  // Menu trigger + the lifecycle the footer renders. `incomingRequest` is
  // the recipient's view (they answer); `outgoingRequest` the sender's.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const blockedByMe = conversation.blocked_by_me;
  const requestState = conversation.request_state;
  const incomingRequest =
    requestState === "pending" &&
    conversation.requested_by !== null &&
    conversation.requested_by !== currentUserId;
  const outgoingRequest = requestState === "pending" && conversation.requested_by === currentUserId;
  const requestDeclined = requestState === "rejected";
  const composerReplaced = blockedByMe || incomingRequest || outgoingRequest || requestDeclined;

  const menuItemClass =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-foreground transition-colors hover:bg-white/[0.08]";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Header — peer identity, back to the list on narrow viewports, and
          the ⋯ menu (Report / Block) that anchors to the right edge. */}
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

        <button
          type="button"
          ref={menuTriggerRef}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          <MoreVertical strokeWidth={2.5} size={18} />
        </button>
        <DropdownMenu
          triggerRef={menuTriggerRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          align="right"
          className="min-w-44 p-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onReport();
            }}
            className={menuItemClass}
          >
            <Flag strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
            <span>Report</span>
          </button>
          {blockedByMe ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onUnblock();
              }}
              className={menuItemClass}
            >
              <ShieldOff strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
              <span>Unblock user</span>
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onBlock();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-red-400 transition-colors hover:bg-red-400/10"
            >
              <Ban strokeWidth={2.5} size={14} className="shrink-0" />
              <span>Block user</span>
            </button>
          )}
        </DropdownMenu>
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

      {/* Static footer — never overlapped by messages. The composer's place
          belongs to whichever lifecycle state applies. */}
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
        {composerReplaced ? (
          <div className="px-4 pb-2.5">
            {actionError && (
              <p role="alert" className="mb-2 pl-1 font-body text-xs text-red-400">
                {actionError}
              </p>
            )}

            {blockedByMe ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2.5">
                <Ban size={15} strokeWidth={2.5} className="shrink-0 text-red-400" aria-hidden="true" />
                <p className="min-w-0 flex-1 font-body text-xs leading-5 text-foreground-muted">
                  You blocked <span className="font-medium text-foreground">{peer.name}</span>.
                  They can&apos;t send you messages.
                </p>
                <PendingButton
                  type="button"
                  onClick={onUnblock}
                  disabled={actionPending !== null}
                  pending={actionPending === "unblock"}
                  pendingLabel="Unblocking…"
                  spinnerSize={12}
                  className="modal-btn modal-btn-secondary"
                >
                  Unblock
                </PendingButton>
              </div>
            ) : incomingRequest ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2.5">
                <p className="min-w-0 flex-1 font-body text-xs leading-5 text-foreground-muted">
                  <span className="font-medium text-foreground">{peer.name}</span> wants to
                  message you. Accept to reply — or reject to close this request.
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <PendingButton
                    type="button"
                    onClick={onRejectRequest}
                    disabled={actionPending !== null}
                    pending={actionPending === "reject"}
                    pendingLabel="Rejecting…"
                    spinnerSize={12}
                    className="modal-btn modal-btn-secondary"
                  >
                    Reject
                  </PendingButton>
                  <PendingButton
                    type="button"
                    onClick={onAcceptRequest}
                    disabled={actionPending !== null}
                    pending={actionPending === "accept"}
                    pendingLabel="Accepting…"
                    spinnerSize={12}
                    className="modal-btn modal-btn-primary"
                  >
                    Accept
                  </PendingButton>
                </div>
              </div>
            ) : outgoingRequest ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                <Clock size={15} strokeWidth={2.5} className="shrink-0 text-foreground-muted" aria-hidden="true" />
                <p className="min-w-0 flex-1 font-body text-xs leading-5 text-foreground-muted">
                  Message request sent —{" "}
                  <span className="font-medium text-foreground">{peer.name}</span> needs to
                  accept before you can send more.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                <XCircle size={15} strokeWidth={2.5} className="shrink-0 text-foreground-muted" aria-hidden="true" />
                <p className="min-w-0 flex-1 font-body text-xs leading-5 text-foreground-muted">
                  {conversation.requested_by === currentUserId
                    ? "Your message request was declined — you can't send more messages here."
                    : "You rejected this message request."}
                </p>
              </div>
            )}
          </div>
        ) : (
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
        )}
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
