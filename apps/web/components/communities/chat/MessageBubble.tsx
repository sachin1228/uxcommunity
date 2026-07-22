"use client";

import { Fragment } from "react";
import { Clock, CheckCheck } from "lucide-react";
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
  onPress: (msg: CachedMessage) => void;
}

function ReplyBubble({ reply, isMe }: { reply: ReplyPreview; isMe: boolean }) {
  return (
    <div
      className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 text-left max-w-full
        ${isMe
          ? "bg-black/20 border-white/40"
          : "bg-black/10 border-foreground-muted/40"
        }`}
    >
      <p className={`font-body text-[10px] font-semibold truncate ${isMe ? "text-accent-foreground/80" : "text-foreground-muted"}`}>
        {reply.user_name}
      </p>
      <p className={`font-body text-[11px] truncate ${isMe ? "text-accent-foreground/70" : "text-foreground-muted"}`}>
        {reply.content}
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
        const iMine = user_ids.includes(currentUserId);
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

export function MessageBubble({
  msg,
  isMe,
  isSameAuthor,
  isFirstUnread,
  unreadDivider,
  currentUserId,
  onPress,
}: MessageBubbleProps) {
  const sender    = msg.users;
  const reactions = msg.reactions ?? [];
  const replyTo   = msg.reply_to ?? null;

  if (isMe) {
    return (
      <Fragment>
        {unreadDivider}
        <div
          className={`flex flex-col items-end ${
            isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
          }`}
        >
          <div className="max-w-[65%]">
            <div className="relative">
              <div
                onClick={() => onPress(msg)}
                className={`rounded-2xl rounded-tr-sm px-3 pt-2 pb-1.5 cursor-pointer select-none
                  active:scale-[0.97] transition-transform ${
                  msg.status === "sending"
                    ? "bg-accent opacity-70"
                    : msg.status === "failed"
                    ? "bg-red-500/80"
                    : "bg-accent"
                }`}
              >
                {replyTo && <ReplyBubble reply={replyTo} isMe />}
                <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
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
        className={`flex items-start gap-2 ${
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
              className="rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 pt-2 pb-1.5 cursor-pointer select-none active:scale-[0.97] transition-transform"
            >
              {replyTo && <ReplyBubble reply={replyTo} isMe={false} />}
              <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">
                {msg.content}
              </p>
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
