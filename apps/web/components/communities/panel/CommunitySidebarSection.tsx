"use client";

/**
 * The sidebar's "Community" block: a collapsible header, a search box, the
 * member's own communities under "Following", open communities to discover
 * under "Suggested", and a footer link to Explore.
 *
 * Following rows are the realtime `CommunityRow`s (previews, unread badges,
 * typing indicators). Suggested rows come from the shared explore cache and
 * join through the same API the Explore page uses, so a join here lands the
 * community in the Following list straight away.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { ArrowRight, ChevronsLeft, Plus, Search, X } from "lucide-react";
import { CommunityRow } from "./CommunityRow";
import { SuggestedCommunityRow } from "./SuggestedCommunityRow";
import { useExploreCommunities } from "./useExploreCommunities";
import { matchesCommunitySearch, selectSuggestedCommunities } from "./suggested-communities";
import { Spinner } from "@/components/ui/Spinner";
import { dedupeFetch } from "@/lib/dedupe-fetch";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { invalidateOnJoin, type CachedSidebarCommunity } from "@/lib/communities/cache";

/** How many suggestions the sidebar shows before "See All Community". */
const SUGGESTED_LIMIT = 6;

/** The search shortcut hint never changes for a session — nothing to subscribe to. */
const subscribeToNothing = () => () => {};

/** Platform find shortcut for the hint badge; "Ctrl" until the client reads it. */
function searchShortcut(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl";
}

const SECTION_LABEL_CLASS =
  "px-[5px] font-body text-[12px] font-semibold leading-none text-foreground";

interface Props {
  userId: string;
  /** The member's communities, unarchived, most recent activity first. */
  communities: CachedSidebarCommunity[];
  loading: boolean;
  activeCommunityId?: string;
  typingMap: Map<string, string>;
  onNavigate: (communityId: string) => void;
  onHover?: (communityId: string) => void;
  onCreate: () => void;
  mobile?: boolean;
}

export function CommunitySidebarSection({
  userId,
  communities,
  loading,
  activeCommunityId,
  typingMap,
  onNavigate,
  onHover,
  onCreate,
  mobile = false,
}: Props) {
  const router = useGuardedRouter();
  const searchRef = useRef<HTMLInputElement>(null);

  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<ReadonlySet<string>>(new Set());

  const { communities: exploreCommunities, loading: exploreLoading } =
    useExploreCommunities(userId);

  // The hint badge shows the platform's find shortcut, which the server cannot
  // know — it renders "Ctrl" and hydration corrects it without a flash.
  const searchKey = useSyncExternalStore(
    subscribeToNothing,
    searchShortcut,
    () => "Ctrl",
  );

  // ⌘F / Ctrl+F focuses the sidebar search — the shortcut the box advertises.
  // Never stolen from another input, textarea or editor.
  useEffect(() => {
    if (collapsed || mobile) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, mobile]);

  const joinedIds = useMemo(
    () => new Set(communities.map((c) => c.id)),
    [communities],
  );

  const following = useMemo(
    () => communities.filter((c) => matchesCommunitySearch(c.name, search)),
    [communities, search],
  );

  const suggestions = useMemo(
    () => selectSuggestedCommunities(exploreCommunities, joinedIds, search, SUGGESTED_LIMIT),
    [exploreCommunities, joinedIds, search],
  );

  const handleJoin = useCallback(async (communityId: string) => {
    setJoiningId(communityId);
    try {
      const res = await dedupeFetch(`/api/communities/${communityId}/join`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (data.status === "requested") {
        // Private community — the owner has to approve before it is followed.
        setRequestedIds((prev) => new Set(prev).add(communityId));
        return;
      }
      invalidateOnJoin(communityId);
    } catch {
      // Leave the row in Suggested; the Explore page surfaces join errors.
    } finally {
      setJoiningId(null);
    }
  }, []);

  const searching = search.trim().length > 0;
  const nothingToShow =
    !loading && !exploreLoading && following.length === 0 && suggestions.length === 0;

  return (
    <section aria-label="Community" className="px-[13px] pb-[6px]">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-[7px] pt-[9px]">
        <span className="px-[5px] font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
          Community
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            aria-controls="sidebar-community-list"
            aria-label={collapsed ? "Expand communities" : "Collapse communities"}
            title={collapsed ? "Expand" : "Collapse"}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <ChevronsLeft
              size={12}
              strokeWidth={2.5}
              className={`transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onCreate}
            aria-label="Create community"
            title="Create community"
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-raised text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <Plus size={11} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div id="sidebar-community-list">
          {/* ── Search ── */}
          <div className="relative mb-[10px]">
            <Search
              size={13}
              strokeWidth={2.5}
              aria-hidden="true"
              className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 text-foreground-muted"
            />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearch("");
              }}
              placeholder="Search community"
              aria-label="Search community"
              className="field w-full pl-[27px] pr-[38px] text-[12px]"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-[6px] top-1/2 flex h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            ) : (
              !mobile && (
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none absolute right-[7px] top-1/2 hidden -translate-y-1/2 items-center gap-[2px] rounded border border-border px-[4px] py-[1px] font-body text-[9px] leading-none text-foreground-muted min-[500px]:flex"
                >
                  {searchKey}F
                </kbd>
              )
            )}
          </div>

          {nothingToShow ? (
            <p className="px-[5px] py-4 font-body text-[11px] text-foreground-muted">
              No communities found
            </p>
          ) : (
            <>
              {/* ── Following — the member's own communities, no heading ── */}
              {loading ? (
                <div className="flex justify-center py-6">
                  <Spinner className="h-4 w-4" />
                </div>
              ) : following.length === 0 ? (
                <p className="px-[5px] font-body text-[11px] leading-snug text-foreground-muted">
                  {searching
                    ? `No followed community matches “${search.trim()}”`
                    : "You haven't joined a community yet."}
                </p>
              ) : (
                <ul className="flex flex-col gap-[3px]">
                  {following.map((c) => (
                    <CommunityRow
                      key={c.id}
                      c={c}
                      active={c.id === activeCommunityId}
                      typingText={typingMap.get(c.id)}
                      onClick={onNavigate}
                      onHover={onHover}
                    />
                  ))}
                </ul>
              )}

              {/* ── Suggested ── */}
              {exploreLoading ? (
                <>
                  <p className={`mt-[14px] ${SECTION_LABEL_CLASS}`}>Suggested</p>
                  <div className="flex justify-center py-4">
                    <Spinner className="h-3.5 w-3.5" />
                  </div>
                </>
              ) : suggestions.length > 0 ? (
                <>
                  <p className={`mt-[14px] ${SECTION_LABEL_CLASS}`}>Suggested</p>
                  <ul className="mt-[7px] flex flex-col gap-[3px]">
                    {suggestions.map((c) => (
                      <SuggestedCommunityRow
                        key={c.id}
                        c={c}
                        onOpen={(id) => router.push(`/dashboard/communities/${id}`)}
                        onJoin={handleJoin}
                        joining={joiningId === c.id}
                        requested={requestedIds.has(c.id)}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}

          {/* ── Footer ── */}
          <Link
            href="/dashboard/communities"
            className="mt-[10px] flex w-full items-center justify-center gap-[6px] rounded-lg border border-border px-[11px] py-[7px] font-body text-[12px] font-medium text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            See All Community
            <ArrowRight size={13} strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
