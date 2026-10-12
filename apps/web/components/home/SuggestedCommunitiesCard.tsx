"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { JoinCommunityModal } from "@/components/communities/JoinCommunityModal";
import type { SuggestedCommunity } from "@/lib/home/suggested";

function formatMembers(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "Member" : "Members"}`;
}

/**
 * Suggested communities — open communities this member is not in yet, biggest
 * first.
 *
 * Join opens the same JoinCommunityModal the Explore page and the community
 * preview use, so this rail joins identically: the dialog shows the community's
 * own about before the member commits, then lands them in the group chat. Only
 * communities that can be joined outright are suggested here (the selection
 * excludes private ones), so the dialog's request path never appears.
 */
export function SuggestedCommunitiesCard({
  communities,
}: {
  communities: SuggestedCommunity[];
}) {
  const router = useRouter();
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [joinTarget, setJoinTarget] = useState<SuggestedCommunity | null>(null);

  const visible = communities.filter((community) => !joinedIds.has(community.id));

  if (visible.length === 0) return null;

  function handleJoined(id: string) {
    setJoinedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    // The dialog records the new membership in the shared cache; this rail only
    // has to stop showing the community and follow the member in.
    setJoinTarget(null);
    router.push(`/dashboard/communities/${id}`);
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
              onClick={() => setJoinTarget(community)}
              aria-label={`Join ${community.name}`}
              className="shrink-0 rounded-full bg-accent px-3 py-1 font-body text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Join
            </button>
          </li>
        ))}
      </ul>

      {joinTarget && (
        <JoinCommunityModal
          community={{
            id: joinTarget.id,
            name: joinTarget.name,
            type: joinTarget.type,
            is_private: joinTarget.is_private,
            image_url: joinTarget.image_url,
            description: joinTarget.description,
            member_count: joinTarget.member_count,
          }}
          onClose={() => setJoinTarget(null)}
          onJoined={handleJoined}
          onRequested={() => setJoinTarget(null)}
        />
      )}
    </section>
  );
}
