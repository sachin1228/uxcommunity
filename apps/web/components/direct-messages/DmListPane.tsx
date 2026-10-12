"use client";

import { memo } from "react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { fmtTimeAgo } from "@/components/communities/chat/chatUtils";
import type { DmConversationSummary } from "@/lib/direct-messages/types";
import { DmChatIcon } from "./DmChatIcon";

/** The one-line preview of a conversation's newest message. */
function previewText(conversation: DmConversationSummary, currentUserId: string): string {
  const last = conversation.last_message;
  if (!last) return "";
  if (last.deleted_at) return "This message was deleted";
  const body = last.content?.trim() || (last.image_url ? "📷 Photo" : "");
  return last.user_id === currentUserId ? `You: ${body}` : body;
}

/**
 * The conversation list pane. Rows follow the sidebar's vocabulary: avatar,
 * name, time, one-line preview, blue unread pill. Conversations start from a
 * member's profile ("Message" chip), so this pane carries no compose flow.
 */
export const DmListPane = memo(function DmListPane({
  conversations,
  activeId,
  currentUserId,
  loading,
  onSelect,
  className = "",
}: {
  conversations: DmConversationSummary[] | null;
  activeId: string | null;
  currentUserId: string;
  loading: boolean;
  onSelect: (conversationId: string) => void;
  className?: string;
}) {
  return (
    <aside className={`flex h-full min-h-0 w-full flex-col border-r border-border bg-background min-[500px]:w-[19rem] min-[500px]:shrink-0 ${className}`}>
      <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h1 className="font-body text-lg font-semibold text-foreground">Messages</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {conversations === null && loading ? (
          <div className="flex h-full items-center justify-center" role="status" aria-label="Loading conversations">
            <Spinner size={22} />
          </div>
        ) : (conversations ?? []).length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <DmChatIcon size={28} className="text-foreground-muted/60" />
            <p className="font-body text-sm text-foreground-muted">No conversations yet.</p>
            <p className="font-body text-xs text-foreground-muted/70">
              Start one from any member profile.
            </p>
          </div>
        ) : (
          (conversations ?? []).map((conversation) => {
            const active = conversation.id === activeId;
            const preview = previewText(conversation, currentUserId);
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  active ? "bg-surface-raised" : "hover:bg-surface-raised/60"
                }`}
                aria-current={active ? "true" : undefined}
              >
                <AvatarImg
                  url={conversation.peer.avatar_url}
                  name={conversation.peer.name}
                  size={44}
                  className="shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-body text-sm font-medium text-foreground">
                      {conversation.peer.name}
                    </span>
                    {conversation.last_message_at && (
                      <span className="shrink-0 font-body text-[11px] text-foreground-muted">
                        {fmtTimeAgo(conversation.last_message_at)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span
                      className={`min-w-0 truncate font-body text-xs ${
                        conversation.last_message?.deleted_at
                          ? "italic text-foreground-muted/70"
                          : "text-foreground-muted"
                      }`}
                    >
                      {preview}
                    </span>
                    {conversation.unread_count > 0 && (
                      <span
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--ds-blue-800)] px-1 font-body text-[10px] font-semibold leading-none text-white"
                        aria-label={`${conversation.unread_count} unread`}
                      >
                        {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
});
