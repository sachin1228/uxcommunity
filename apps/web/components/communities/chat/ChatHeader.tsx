"use client";

import { Calendar, MessageCircle, MessagesSquare, Users } from "lucide-react";
import { TYPE_EMOJI } from "./chatUtils";

interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
}

interface ChatHeaderProps {
  community: Community | null;
  activeTab: ChatTab;
  onTabChange: (tab: ChatTab) => void;
  onlineCount?: number;
}

export type ChatTab = "chat" | "threads" | "events" | "members";

export function ChatHeader({
  community,
  activeTab,
  onTabChange,
  onlineCount = 0,
}: ChatHeaderProps) {
  return (
    <div className="px-5 pt-4 border-b border-border shrink-0">
      {community ? (
        <>
           <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-surface-raised flex items-center justify-center text-sm shrink-0 overflow-hidden">
                {community.image_url ? (
                  <img
                    src={community.image_url}
                    alt={community.name}
                    className="h-11 w-11 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.parentElement!.textContent =
                        TYPE_EMOJI[community.type] ?? "💬";
                    }}
                  />
                ) : (
                  TYPE_EMOJI[community.type] ?? "💬"
                )}
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-foreground leading-none">
                  {community.name}
                </h3>
                <p className="font-body text-[11px] text-foreground-muted mt-0.5 flex items-center gap-1">
                  <Users size={10} /> {community.member_count} member
                  {community.member_count !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-body text-xs text-foreground-muted">
                {onlineCount} online
              </span>
            </div>
          </div>
          <nav className="flex items-center gap-5" aria-label="Community views">
            {([
              ["chat",    "Chat",    MessageCircle],
              ["threads", "Threads", MessagesSquare],
              ["events",  "Events",  Calendar],
              ["members", "Members", Users],
            ] as const).map(([tab, label, Icon]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => onTabChange(tab)}
                className={`border-b-2 px-3 py-2.5 font-body text-xs transition-colors ${
                  activeTab === tab
                    ? "border-accent text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </span>
              </button>
            ))}
          </nav>
        </>
      ) : (
        /* Skeleton header while loading */
        <div className="h-5 w-48 rounded bg-surface-raised animate-pulse" />
      )}
    </div>
  );
}
