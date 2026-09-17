"use client";

import { Check, Lock, Plus } from "lucide-react";
import { CommunityAvatar } from "./CommunityAvatar";
import { communityMetaLine } from "./community-label";
import type { CachedExploreCommunity } from "@/lib/communities/cache";

interface Props {
  c: CachedExploreCommunity;
  /** Opens the community page (the row body, not the join button). */
  onOpen: (communityId: string) => void;
  onJoin: (communityId: string) => void;
  /** A join request for this row is in flight. */
  joining: boolean;
  /** Private community — the request was sent and is awaiting approval. */
  requested: boolean;
}

/**
 * One row under "Suggested": category tag + member count, the community name,
 * and the trailing join button. Lands the row in "Following" the moment the
 * join succeeds (the sidebar list refetches on the join event).
 */
export function SuggestedCommunityRow({
  c,
  onOpen,
  onJoin,
  joining,
  requested,
}: Props) {
  return (
    <li>
      <div className="flex w-full items-center gap-[11px] rounded-lg px-[9px] py-[7px] transition-colors hover:bg-surface-raised">
        <button
          type="button"
          onClick={() => onOpen(c.id)}
          className="flex min-w-0 flex-1 items-center gap-[11px] text-left"
        >
          <CommunityAvatar imageUrl={c.image_url} name={c.name} type={c.type} />

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-body text-[11px] leading-none text-foreground-muted">
              {communityMetaLine(c)}
            </span>
            <span className="mt-[5px] flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate font-body text-[14px] font-medium text-foreground">
                {c.name}
              </span>
              {c.is_private && (
                <Lock
                  strokeWidth={2.5}
                  size={11}
                  className="shrink-0 text-foreground-muted"
                  aria-label="Private community"
                />
              )}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onJoin(c.id)}
          disabled={joining || requested}
          aria-label={
            requested ? `Join request sent for ${c.name}` : `Join ${c.name}`
          }
          title={requested ? "Request sent" : "Join community"}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground-muted ring-1 ring-inset ring-white/10 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          {requested ? (
            <Check size={12} strokeWidth={2.5} />
          ) : (
            <Plus size={12} strokeWidth={2.5} />
          )}
        </button>
      </div>
    </li>
  );
}
