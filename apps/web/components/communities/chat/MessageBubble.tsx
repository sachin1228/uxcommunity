"use client";

import { Fragment } from "react";
import { Clock, CheckCheck, X } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import type { CachedMessage, MessageReaction, ReplyPreview } from "@/lib/communities/cache";

interface MessageBubbleProps {
  msg: CachedMessage;
  isMe: boolean;
  isSameAuthor: boolean;
  isFirstUnread: boolean;
  unreadDivider: React.ReactNode;
  currentUserId: string;
  highlighted: boolean;
  onPress: (msg: CachedMessage) => void;
  onReplyClick: (replyId: string) => void;
  onCancelSend: (msgId: string) => void;
}

function ReplyBubble({
  reply,
  isMe,
  onReplyClick,
}: {
  reply: ReplyPreview;
  isMe: boolean;
  onReplyClick: (replyId: string) => void;
}) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onReplyClick(reply.id); }}
      className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 text-left max-w-full cursor-pointer
        ${isMe
          ? "bg-black/20 border-white/20 hover:bg-black/30"
          : "bg-black/10 border-white/15 hover:bg-black/20"
        } transition-colors`}
    >
      <p className={`font-body text-[10px] font-semibold truncate ${isMe ? "text-accent-foreground/80" : "text-foreground-muted"}`}>
        {reply.user_name}
      </p>
      <p className={`font-body text-[11px] truncate ${isMe ? "text-accent-foreground/70" : "text-foreground-muted"}`}>
        {reply.content || "📷 Image"}
      </p>
    </div>
  );
}

function ReactionPills({
  reactions,
  currentUserId,
  isMe,
}: {
  reactions: MessageReaction[];
  currentUserId: string;
  isMe: boolean;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 mt-1 absolute -bottom-[14px] left-[12px] ${isMe ? "justify-end" : "justify-start"}`}>
      {reactions.map(({ emoji, user_ids }) => {
        return (
          <span
            key={emoji}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] font-medium select-none bg-[#2a2a2a] border border-black text-foreground"
          >
            {emoji}
            {user_ids.length > 1 && (
              <span className="text-[10px] opacity-70">{user_ids.length}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Image rendered inside a message bubble. */
function BubbleImage({
  url, isMe, uploading, onCancel,
}: {
  url: string; isMe: boolean; uploading?: boolean; onCancel?: () => void;
}) {
  return (
    <div className="relative mb-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Image"
        className={`block max-w-full rounded-xl object-cover ${isMe ? "opacity-95" : ""} ${uploading ? "opacity-50" : ""}`}
        style={{ maxHeight: 300, width: "auto" }}
        loading="lazy"
      />
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          <div className="relative w-12 h-12">
            {/* Spinner ring */}
            <div className="absolute inset-0 rounded-full border-[3px] border-white/20 border-t-white animate-spin" />
            {/* Cancel button */}
            <button
              onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
              className="absolute inset-0 flex items-center justify-center text-white"
              aria-label="Cancel upload"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  msg,
  isMe,
  isSameAuthor,
  isFirstUnread,
  unreadDivider,
  currentUserId,
  highlighted,
  onPress,
  onReplyClick,
  onCancelSend,
}: MessageBubbleProps) {
  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;
  const imageUrl  = msg.image_url ?? null;
  const uploading = msg.status === "sending" && !!imageUrl;

  const rowHighlight = highlighted ? "bg-black/60" : "";

  if (isMe) {
    return (
      <Fragment>
        {unreadDivider}
        <div
          data-message-id={msg.id}
          className={`flex flex-col items-end w-full px-5 transition-colors duration-300 ${rowHighlight} ${
            isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
          }`}
        >
          <div className="max-w-[65%]">
            <div className="relative">
              <div
                onClick={() => onPress(msg)}
                className={`rounded-2xl rounded-tr-sm px-3 pt-2 pb-1.5 cursor-pointer select-none
                  active:scale-[0.97] transition-all ${
                  msg.status === "sending"
                    ? "bg-accent opacity-70"
                    : msg.status === "failed"
                    ? "bg-red-500/80"
                    : "bg-accent"
                }`}
              >
                {replyTo && <ReplyBubble reply={replyTo} isMe onReplyClick={onReplyClick} />}
                {imageUrl && <BubbleImage url={imageUrl} isMe uploading={uploading} onCancel={() => onCancelSend(msg.id)} />}
                {msg.content && (
                  <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="font-mono text-[10px] text-accent-foreground/60">
                    {fmtTime(msg.created_at)}
                  </span>
                  {msg.status === "sending" && (
                    <Clock size={10} className="text-accent-foreground/60 animate-pulse" />
                  )}
                  {(msg.status === "sent" || !msg.status) && (
                    <CheckCheck size={11} className="text-accent-foreground/70" />
                  )}
                  {msg.status === "failed" && (
                    <span className="text-[10px] text-red-200">!</span>
                  )}
                </div>
              </div>
              <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe />
            </div>
            {reactions.length > 0 && <div className="h-5" />}
          </div>
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      {unreadDivider}
      <div
        data-message-id={msg.id}
        className={`flex items-start gap-2 w-full px-5 transition-colors duration-300 ${rowHighlight} ${
          isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
        }`}
      >
        <div className="w-7 shrink-0">
          {!isSameAuthor && sender && (
            <ChatAvatar name={sender.name} url={sender.avatar_url} size={7} />
          )}
        </div>
        <div className="max-w-[65%]">
          {!isSameAuthor && sender && (
            <p className="font-body text-[11px] font-medium text-foreground-muted mb-0.5 ml-0.5">
              {sender.name}
            </p>
          )}
          <div className="relative">
            <div
              onClick={() => onPress(msg)}
              className={`rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 pt-2 pb-1.5 cursor-pointer select-none active:scale-[0.97] transition-all`}
            >
              {replyTo && <ReplyBubble reply={replyTo} isMe={false} onReplyClick={onReplyClick} />}
              {imageUrl && <BubbleImage url={imageUrl} isMe={false} uploading={uploading} onCancel={() => onCancelSend(msg.id)} />}
              {msg.content && (
                <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
              )}
              <p className="font-mono text-[10px] text-foreground-muted text-right mt-1">
                {fmtTime(msg.created_at)}
              </p>
            </div>
            <ReactionPills reactions={reactions} currentUserId={currentUserId} isMe={false} />
          </div>
          {reactions.length > 0 && <div className="h-5" />}
        </div>
      </div>
    </Fragment>
  );
}
