"use client";

import { Users } from "lucide-react";
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
}

export function ChatHeader({ community }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0">
      {community ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-surface-raised flex items-center justify-center text-sm shrink-0 overflow-hidden">
              {community.image_url ? (
                <img
                  src={community.image_url}
                  alt={community.name}
                  className="h-9 w-9 rounded-full object-cover"
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
              <h3 className="font-display text-sm font-semibold text-foreground leading-none">
                {community.name}
              </h3>
              <p className="font-body text-[11px] text-foreground-muted mt-0.5 flex items-center gap-1">
                <Users size={10} /> {community.member_count} member
                {community.member_count !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-foreground-muted" />
            <span className="font-body text-xs text-foreground-muted">
              {community.member_count} member
              {community.member_count !== 1 ? "s" : ""}
            </span>
          </div>
        </>
      ) : (
        /* Skeleton header while loading */
        <div className="h-5 w-48 rounded bg-surface-raised animate-pulse" />
      )}
    </div>
  );
}
