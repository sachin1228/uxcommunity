"use client";

import { MessageSquare, Search } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow } from "./panel/CommunityRow";
import { useSidebarCommunities } from "./panel/useSidebarCommunities";

export function CommunitiesPanel({ userId }: { userId: string }) {
  const {
    communities,
    loading,
    activeCommunityId,
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
    <div className="flex flex-col h-full w-72 shrink-0 border-r border-border bg-surface">
      <button
        onClick={() => router.push("/dashboard/communities")}
        className={`flex items-center gap-2 mx-3 mt-3 mb-1 px-3 py-2 rounded-lg font-body text-xs font-medium transition-colors text-left ${
          pathname === "/dashboard/communities"
            ? "bg-accent/10 text-accent"
            : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
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
          <div className="px-4 py-10 text-center">
            <MessageSquare
              size={24}
              className="mx-auto text-foreground-muted mb-2 opacity-40"
            />
            <p className="font-body text-xs text-foreground-muted">
              No communities yet
            </p>
          </div>
        ) : (
          <div className="py-0.5">
            <div className="px-3 pt-2 pb-0.5">
              <span className="font-body text-[8px] font-semibold uppercase tracking-widest text-foreground-muted">
                All
              </span>
            </div>
            <ul className="space-y-px">
              {sorted.map((c) => (
                <CommunityRow
                  key={c.id}
                  c={c}
                  active={c.id === activeCommunityId}
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
