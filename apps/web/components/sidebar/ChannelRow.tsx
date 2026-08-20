"use client";

import { Hash } from "lucide-react";
import type { CachedCommunityChannel } from "@/lib/communities/cache";

interface ChannelRowProps {
  channel: CachedCommunityChannel;
  active: boolean;
  onClick: () => void;
}

export function ChannelRow({ channel, active, onClick }: ChannelRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 font-body text-[13px] transition-colors ${
          active
            ? "bg-accent/10 text-accent"
            : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
        }`}
      >
        <Hash size={13} className="shrink-0 opacity-70" />
        <span className="flex-1 truncate text-left">{channel.name}</span>
      </button>
    </li>
  );
}