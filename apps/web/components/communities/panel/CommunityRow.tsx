"use client";

import { CommunityAvatar } from "./CommunityAvatar";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

type Community = CachedSidebarCommunity;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface CommunityRowProps {
  c: Community;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function CommunityRow({
  c,
  active,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: CommunityRowProps) {
  return (
    <li>
      <button
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
          active
            ? "bg-accent/10 border-l-2 border-l-accent"
            : "hover:bg-surface-raised border-l-2 border-l-transparent"
        }`}
      >
        <CommunityAvatar
          imageUrl={c.image_url}
          name={c.name}
          type={c.type}
          active={active}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className="font-body text-[13px] font-medium truncate text-foreground">
              {c.name}
            </span>
            {c.last_message && (
              <span className="font-mono text-xs text-foreground-muted shrink-0">
                {timeAgo(c.last_message.created_at)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {c.last_message ? (
              <p className="font-body text-xs text-foreground-muted truncate flex-1">
                {c.last_message.user && (
                  <span className="font-medium">
                    {c.last_message.user.name.split(" ")[0]}:
                  </span>
                )}{" "}
                {c.last_message.content}
              </p>
            ) : (
              <p className="font-body text-xs text-foreground-muted/60 italic flex-1">
                No messages yet
              </p>
            )}
            {c.message_count > 0 && !active && (
              <span className="flex items-center justify-center p-1 min-w-[20px] h-[16px] rounded-full bg-green-500 text-white font-mono text-[11px] leading-[10px] font-semibold shrink-0">
                {c.message_count > 99 ? "99+" : c.message_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
