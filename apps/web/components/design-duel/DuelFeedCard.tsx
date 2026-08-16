"use client";

import { Swords } from "lucide-react";
import { communityFeedLayout } from "../communities/feed-layout";
import { PostAuthorMeta } from "../communities/PostAuthorMeta";
import { DesignPreview } from "./DesignPreview";
import { sanitizeDesign } from "@/lib/design-duel/design";

export interface DuelFeedItem {
  id: string;
  user_id: string;
  created_at: string;
  title: string;
  _type: "duel";
  duel: {
    duel_id: string;
    challenge_title: string;
    winner: {
      name: string;
      avatar_url: string | null;
      image_url: string | null;
      design_json: unknown;
      percent: number | null;
    };
    loser: {
      name: string;
      avatar_url: string | null;
      image_url: string | null;
      design_json: unknown;
      percent: number | null;
    };
    vote_count: number;
  };
  users: { name: string; avatar_url: string | null } | null;
}

interface DuelFeedCardProps {
  item: DuelFeedItem;
  isLast?: boolean;
  onOpen: () => void;
}

export function DuelFeedCard({ item, isLast = false, onOpen }: DuelFeedCardProps) {
  const { duel } = item;
  const winnerDesign = sanitizeDesign(duel.winner.design_json);
  const loserDesign = sanitizeDesign(duel.loser.design_json);

  return (
    <article
      tabIndex={0}
      role="link"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
      className={`${communityFeedLayout.row} cursor-pointer ${isLast ? "" : communityFeedLayout.dividerBottom}`}
    >
      <div className="flex items-start justify-between gap-4">
        <PostAuthorMeta
          name={item.users?.name}
          avatarUrl={item.users?.avatar_url}
          createdAt={item.created_at}
          dateInline
          secondaryLabel={`Design Duel · ${duel.challenge_title}`}
        />
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 font-body text-[11px] font-semibold text-accent">
          <Swords size={13} />
          Duel
        </span>
      </div>

      <h2 className="mt-3 text-pretty font-display text-base font-semibold text-foreground">
        {duel.challenge_title} — won by {duel.winner.name}
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="overflow-hidden rounded-xl border-2 border-accent/40 bg-surface-raised">
          <DesignPreview design={winnerDesign} imageUrl={duel.winner.image_url} className="max-h-[260px]" />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate font-body text-xs font-semibold text-foreground">
              {duel.winner.name}
            </span>
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 font-body text-[11px] font-bold text-accent">
              WIN
            </span>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised opacity-90">
          <DesignPreview design={loserDesign} imageUrl={duel.loser.image_url} className="max-h-[260px]" />
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="truncate font-body text-xs font-medium text-foreground-muted">
              {duel.loser.name}
            </span>
            <span className="shrink-0 font-body text-xs font-semibold text-foreground-subtle">
              {duel.winner.percent != null && duel.loser.percent != null
                ? `${duel.winner.percent}% · ${duel.loser.percent}%`
                : "vs"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="font-body text-xs text-foreground-subtle">
          {duel.vote_count} {duel.vote_count === 1 ? "vote" : "votes"}
        </span>
        <span className="inline-flex items-center gap-1 font-body text-xs font-semibold text-accent">
          View duel
        </span>
      </div>
    </article>
  );
}