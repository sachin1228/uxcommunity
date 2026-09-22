"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { invalidateOnJoin } from "@/lib/communities/cache";
import type { SuggestedCommunity } from "@/lib/home/suggested";

function formatMembers(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "Member" : "Members"}`;
}

/**
 * Suggested communities — open communities this member is not in yet, biggest
 * first.
 *
 * Joining mirrors the Explore page: the row disappears optimistically, the
 * shared community caches are invalidated so the left sidebar picks the
 * community up immediately, and a rejected join puts the row back with the
 * server's reason. Only communities that can be joined outright are suggested
 * here, so there is no request-to-join state to render.
 */
export function SuggestedCommunitiesCard({
  communities,
}: {
  communities: SuggestedCommunity[];
}) {
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = communities.filter((community) => !joinedIds.has(community.id));

  function hide(id: string, hidden: boolean) {
    setJoinedIds((current) => {
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleJoin(id: string) {
    if (pendingId) return;
    setPendingId(id);
    setError(null);
    hide(id, true);
    // Tell the sidebar's community list (and the Explore page) that this member
    // now belongs here — one event, both surfaces.
    invalidateOnJoin(id);

    try {
      const res = await dedupeFetch(`/api/communities/${id}/join`, { method: "POST" });
      if (res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      hide(id, false);
      setError(data.error ?? "Failed to join. Please try again.");
    } catch {
      hide(id, false);
      setError("Network error. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      aria-labelledby="home-suggested-heading"
      className="overflow-hidden rounded-xl border border-border bg-background-subtle"
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <Users size={15} strokeWidth={2.5} className="text-foreground-muted" aria-hidden="true" />
        <h2
          id="home-suggested-heading"
          className="font-display text-sm font-semibold text-foreground"
        >
          Suggested Communities
        </h2>
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 font-body text-[11px] leading-snug text-red-400"
        >
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="px-4 pb-4 font-body text-xs leading-relaxed text-foreground-muted">
          {error
            ? "Nothing to show right now."
            : "You're in every community that matches your profile — check back as new ones open."}
        </p>
      ) : (
        <ul className="flex flex-col px-4 pb-3">
          {visible.map((community) => (
            <li
              key={community.id}
              className="flex items-center gap-3 py-2.5"
            >
              <CommunityDp imageUrl={community.image_url} name={community.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-sm font-medium text-foreground">
                  {community.name}
                </p>
                {community.description && (
                  <p className="mt-0.5 line-clamp-1 font-body text-[11px] text-foreground-muted">
                    {community.description}
                  </p>
                )}
                <p className="mt-0.5 font-body text-[11px] text-foreground-subtle">
                  {formatMembers(community.member_count)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleJoin(community.id)}
                disabled={pendingId !== null}
                aria-label={`Join ${community.name}`}
                className="shrink-0 rounded-full bg-accent px-3 py-1 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
              >
                {pendingId === community.id ? "Joining…" : "Join"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
