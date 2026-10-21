"use client";

import { memo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { DmIcon } from "@/components/ui/DmIcon";
import { Spinner } from "@/components/ui/Spinner";
import { fmtTimeAgo } from "@/components/communities/chat/chatUtils";
import { NotoEmojiSvg } from "@/components/communities/chat/NotoEmojiSvg";
import {
  ImagePreviewWord,
  renderTextWithEmoji,
} from "@/components/communities/panel/sidebar-preview-parts";
import { messagePreview } from "@/lib/direct-messages/preview-text";
import { filterConversations } from "@/lib/direct-messages/search";
import type { DmConversationSummary } from "@/lib/direct-messages/types";

/**
 * The conversation list pane. Rows follow the sidebar's vocabulary: avatar,
 * name, time, one-line preview, blue unread pill — and, while the peer types,
 * the community sidebar's "typing…" line in the preview's place. Conversations
 * start from a member's profile ("Message" chip), so this pane carries no
 * compose flow. A search box filters the rows by peer name — kept as the
 * pane's own state so a keystroke never re-renders the thread beside it.
 */
export const DmListPane = memo(function DmListPane({
  conversations,
  activeId,
  currentUserId,
  loading,
  typingByConversation,
  onSelect,
  onBack,
  className = "",
}: {
  conversations: DmConversationSummary[] | null;
  activeId: string | null;
  currentUserId: string;
  loading: boolean;
  /** conversationId → typing label. Takes the preview line's place, exactly as
   *  the community sidebar's rows do. Referentially stable between typing
   *  transitions, so idle sweeps never re-render a row. */
  typingByConversation: Map<string, string>;
  onSelect: (conversationId: string) => void;
  /** History back — the window has no sidebar, so the heading carries the
   *  exit to wherever the member came from. */
  onBack: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  // Rows this viewer should not see: a rejected request is closed for both
  // sides, and the viewer's blocked peers drop out of their pane. The server
  // list already omits both — this also covers locally patched state before
  // the next refetch.
  const all = (conversations ?? []).filter(
    (conversation) => !conversation.blocked_by_me && conversation.request_state !== "rejected",
  );
  const visible = filterConversations(all, query);

  return (
    <aside className={`flex h-full min-h-0 w-full flex-col border-r border-border bg-background min-[500px]:w-[19rem] min-[500px]:shrink-0 ${className}`}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
        {/* The glyph, not the hit area, is what lines up. Two insets stack up
            between this button's box and the ink: the 20px icon centred in a
            32px button (6px) and the chevron's own ink inside its 20px box
            (~6.5px at strokeWidth 2.5). -ml-[12.5px] cancels both, so the
            chevron's edge sits on the pane's content edge — the same left
            inset as the brand logo above it, the search field and the rows
            below. The round hit area bleeds left into the padding instead. */}
        <button
          type="button"
          onClick={onBack}
          className="-ml-[12.5px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Back"
          title="Back"
        >
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
        <h1 className="font-body text-base font-semibold text-foreground">Messages</h1>
      </header>

      {/* Search — same field, glyph and copy as the members pane. Escape clears
          the query so the full list is always one key away. */}
      <div className="shrink-0 px-3 pb-1 pt-3 sm:px-4">
        <div className="relative">
          <Search
            size={14}
            strokeWidth={2.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="field w-full pl-8 pr-3"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {conversations === null && loading ? (
          <div className="flex h-full items-center justify-center" role="status" aria-label="Loading conversations">
            <Spinner size={22} />
          </div>
        ) : all.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <DmIcon size={24} className="text-foreground-muted/60" />
            <p className="font-body text-sm text-foreground-muted">No conversations yet.</p>
            <p className="font-body text-xs text-foreground-muted/70">
              Start one from any member profile.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Search size={24} strokeWidth={2} className="text-foreground-muted/60" />
            <p className="font-body text-sm text-foreground-muted">No conversations found</p>
            <p className="font-body text-xs text-foreground-muted/70">
              Try a different name.
            </p>
          </div>
        ) : (
          visible.map((conversation) => {
            const active = conversation.id === activeId;
            const preview = messagePreview(conversation.last_message, currentUserId);
            const reaction = conversation.last_reaction ?? null;
            const typingText = typingByConversation.get(conversation.id) ?? "";
            // A request still awaiting THIS viewer's answer — the row says so
            // instead of previewing the message (the thread holds the full
            // message plus Accept / Reject).
            const incomingRequest =
              conversation.request_state === "pending" &&
              conversation.requested_by !== null &&
              conversation.requested_by !== currentUserId;
            return (
              // px-3/sm:px-4 — the brand's own inset (the topbar logo starts at
              // pl-3, then pl-4 from sm), so avatars, search field and chevron
              // share one left edge.
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4 ${
                  active ? "bg-surface-raised" : "hover:bg-surface-raised/60"
                }`}
                aria-current={active ? "true" : undefined}
              >
                <AvatarImg
                  url={conversation.peer.avatar_url}
                  name={conversation.peer.name}
                  size={40}
                  className="shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-body text-sm font-medium text-foreground">
                      {conversation.peer.name}
                    </span>
                    {!typingText && conversation.last_message_at && (
                      <span className="shrink-0 font-body text-[11px] text-foreground-muted">
                        {fmtTimeAgo(conversation.last_message_at)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    {typingText ? (
                      /* Typing — highest priority, like the community sidebar */
                      <span className="min-w-0 truncate font-body text-[13px] leading-5 text-accent">
                        {typingText}
                      </span>
                    ) : incomingRequest ? (
                      /* A pending request the viewer has not answered yet —
                         takes the preview line's place so it cannot be missed. */
                      <span className="min-w-0 truncate font-body text-[13px] font-medium leading-5 text-accent">
                        Message request
                      </span>
                    ) : reaction ? (
                      /* Reaction — "John reacted ❤️ to: \"ok\"", the same line the
                         community sidebar draws, above the message preview. */
                      <span className="min-w-0 truncate font-body text-[13px] leading-5 text-foreground-muted">
                        <span className="font-medium">{reaction.firstName}</span>
                        {" reacted "}
                        <NotoEmojiSvg
                          emoji={reaction.emoji}
                          size={14}
                          className="align-middle mx-0.5"
                        />
                        {" to: "}
                        {reaction.messagePreviewMedia === "image" ? (
                          <ImagePreviewWord word={reaction.messagePreview} />
                        ) : (
                          <span>{reaction.messagePreview}</span>
                        )}
                      </span>
                    ) : preview.text ? (
                      <span
                        className={`min-w-0 truncate font-body text-[13px] leading-5 ${
                          preview.deleted
                            ? "italic text-foreground-muted/70"
                            : "text-foreground-muted"
                        }`}
                      >
                        {preview.prefix && (
                          <span className="font-medium">{preview.prefix}: </span>
                        )}
                        {preview.media === "image" ? (
                          <ImagePreviewWord word={preview.text} />
                        ) : (
                          renderTextWithEmoji(preview.text)
                        )}
                      </span>
                    ) : null}
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
