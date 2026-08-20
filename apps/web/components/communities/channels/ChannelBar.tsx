"use client";

import { Hash, Plus } from "lucide-react";
import type { CachedCommunityChannel } from "@/lib/communities/cache";

interface ChannelBarProps {
  channels: CachedCommunityChannel[];
  /** null = the community's default "general" chat. */
  activeChannelId: string | null;
  onSelect: (channelId: string | null) => void;
  canManage: boolean;
  onManage: () => void;
}

export function ChannelBar({ channels, activeChannelId, onSelect, canManage, onManage }: ChannelBarProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-surface/40 px-4 py-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs transition-colors ${
          activeChannelId === null
            ? "border-accent bg-accent/10 text-accent"
            : "border-border text-foreground-muted hover:border-accent/50 hover:text-foreground"
        }`}
      >
        <Hash size={12} />
        general
      </button>
      {channels.map((ch) => (
        <button
          key={ch.id}
          type="button"
          onClick={() => onSelect(ch.id)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs transition-colors ${
            activeChannelId === ch.id
              ? "border-accent bg-accent/10 text-accent"
              : "border-border text-foreground-muted hover:border-accent/50 hover:text-foreground"
          }`}
        >
          <Hash size={12} />
          {ch.name}
        </button>
      ))}
      {canManage && (
        <button
          type="button"
          onClick={onManage}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent hover:text-accent"
          aria-label="Manage channels"
          title="Manage channels"
        >
          <Plus size={13} />
          New
        </button>
      )}
    </div>
  );
}