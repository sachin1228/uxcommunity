"use client";

import { useState } from "react";
import { MessageSquare, Plus, Search } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow } from "./panel/CommunityRow";
import { CreateCommunityModal } from "./CreateCommunityModal";
import { useSidebarCommunities } from "./panel/useSidebarCommunities";
import { invalidateCommunitiesList } from "@/lib/communities/cache";

export function CommunitiesPanel({ userId }: { userId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const {
    communities,
    loading,
    activeCommunityId,
    typingMap,
    handleNavigate,
    onEnter,
    onLeave,
    pathname,
    router,
  } = useSidebarCommunities(userId);

  const sorted = [...communities].sort((a, b) => {
    const ta = a.last_message?.created_at ?? "";
    const tb = b.last_message?.created_at ?? "";
    if (tb > ta) return 1;
    if (ta > tb) return -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-r border-border">
      {createOpen && (
        <CreateCommunityModal
          open
          onClose={() => setCreateOpen(false)}
          onCreated={(community) => {
            invalidateCommunitiesList();
            router.push(`/dashboard/communities/${community.id}`);
          }}
        />
      )}

      <button
        onClick={() => router.push("/dashboard/communities")}
        className={`flex items-center gap-2 mx-3 mt-3 mb-1 px-3 py-2 rounded-lg font-body text-xs font-medium transition-colors text-left ${
          pathname === "/dashboard/communities"
            ? "bg-accent/10 text-accent"
            : "text-foreground-muted hover:text-foreground bg-surface-raised hover:bg-surface-raised-hover"
        }`}
      >
        <Search size={13} />
        Explore Communities
      </button>

      <div className="mx-2 mb-0.5" />

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : communities.length === 0 ? (
          <div className="py-0.5">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                Your Community
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                aria-label="Create community"
                title="Create community"
              >
                <Plus size={12} strokeWidth={2.4} />
              </button>
            </div>
            <div className="px-4 py-10 text-center">
              <MessageSquare
                size={24}
                className="mx-auto text-foreground-muted mb-2 opacity-40"
              />
              <p className="font-body text-xs text-foreground-muted">
                No communities yet
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Plus size={12} />
                Create Community
              </button>
            </div>
          </div>
        ) : (
          <div className="py-0.5">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="font-body text-[10px] font-semibold uppercase tracking-widest text-foreground-muted">
                Your Community
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                aria-label="Create community"
                title="Create community"
              >
                <Plus size={12} strokeWidth={2.4} />
              </button>
            </div>
            <ul className="space-y-0.5">
              {sorted.map((c) => (
                <CommunityRow
                  key={c.id}
                  c={c}
                  active={c.id === activeCommunityId}
                  typingText={typingMap.get(c.id)}
                  onClick={() => handleNavigate(c.id)}
                  onMouseEnter={() => onEnter(c.id)}
                  onMouseLeave={onLeave}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
