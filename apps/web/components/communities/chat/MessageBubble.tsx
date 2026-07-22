"use client";

import { Fragment } from "react";
import { Clock, CheckCheck } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import { fmtTime } from "./chatUtils";
import type { CachedMessage } from "@/lib/communities/cache";

interface MessageBubbleProps {
  msg: CachedMessage;
  isMe: boolean;
  isSameAuthor: boolean;
  isFirstUnread: boolean;
  unreadDivider: React.ReactNode;
}

export function MessageBubble({
  msg,
  isMe,
  isSameAuthor,
  isFirstUnread,
  unreadDivider,
}: MessageBubbleProps) {
  const sender = msg.users;

  if (isMe) {
    return (
      <Fragment>
        {unreadDivider}
        <div
          className={`flex justify-end ${
            isSameAuthor && !isFirstUnread ? "mt-0.5" : "mt-3"
          }`}
        >
          <div className="max-w-[65%]">
            <div
              className={`rounded-2xl rounded-tr-sm px-3 py-2 transition-opacity ${
                msg.status === "sending"
                  ? "bg-accent opacity-70"
                  : msg.status === "failed"
                  ? "bg-red-500/80"
                  : "bg-accent"
              }`}
            >
              <p className="font-body text-sm text-accent-foreground whitespace-pre-wrap break-words">
                {msg.content}
              </p>
            </div>
            <div className="flex items-center justify-end gap-1 mt-0.5 pr-1">
              <span className="font-mono text-[10px] text-foreground-muted">
                {fmtTime(msg.created_at)}
              </span>
              {msg.status === "sending" && (
                <Clock size={10} className="text-foreground-muted animate-pulse" />
              )}
              {(msg.status === "sent" || !msg.status) && (
                <CheckCheck size={11} className="text-accent" />
              )}
              {msg.status === "failed" && (
                <span className="text-[10px] text-red-400">!</span>
              )}
            </div>
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
          <div className="rounded-2xl rounded-tl-sm bg-surface-raised shadow-sm px-3 py-2">
            <p className="font-body text-sm text-foreground whitespace-pre-wrap break-words">
              {msg.content}
            </p>
          </div>
          <p className="font-mono text-[10px] text-foreground-muted mt-0.5 ml-0.5">
            {fmtTime(msg.created_at)}
          </p>
        </div>
      </div>
    </Fragment>
  );
}
