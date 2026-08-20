"use client";

import { Fragment, Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Gamepad2, Home, MessageSquare, Plus, Users } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow } from "@/components/communities/panel/CommunityRow";
import { ChannelRow } from "@/components/sidebar/ChannelRow";
import { ChannelManagerModal } from "@/components/communities/channels/ChannelManagerModal";
import { useCommunityChannels } from "@/components/communities/channels/useCommunityChannels";
import { useSidebarCommunities } from "@/components/communities/panel/useSidebarCommunities";
import { CreateCommunityModal } from "@/components/communities/CreateCommunityModal";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

interface Props {
  userId: string;
  mobile?: boolean;
}

type Community = CachedSidebarCommunity;

function isMatch(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

/** The community list plus nested subchannel rows + channel manager modal.
 *  Isolated so useSearchParams can live behind a Suspense boundary. */
function CommunityListSection({
  userId,
  communities,
  activeCommunityId,
  typingMap,
  handleNavigate,
  router,
}: {
  userId: string;
  communities: Community[];
  activeCommunityId?: string;
  typingMap: Map<string, string>;
  handleNavigate: (id: string) => void;
  router: ReturnType<typeof useSidebarCommunities>["router"];
}) {
  const searchParams = useSearchParams();
  const activeChannelId = searchParams.get("channel");
  const [manageCommunityId, setManageCommunityId] = useState<string | null>(null);

  const manageCommunity = manageCommunityId
    ? communities.find((c) => c.id === manageCommunityId) ?? null
    : null;
  const {
    channels,
    loading: channelsLoading,
    createChannel,
    renameChannel,
    deleteChannel,
  } = useCommunityChannels({
    communityId: manageCommunity?.id ?? "",
    currentUserId: userId,
    enabled: !!manageCommunity,
  });

  const openCommunity = (id: string, channelId: string | null) => {
    const base = `/dashboard/communities/${id}`;
    router.push(channelId ? `${base}?channel=${encodeURIComponent(channelId)}` : base);
  };

  return (
    <>
      <ul className="space-y-0.5 px-3">
        {communities.map((c) => {
          const isOwner = c.owner_id === userId;
          const communityChannels = c.channels ?? [];
          const showChannels = communityChannels.length > 0 || isOwner;
          return (
            <Fragment key={c.id}>
              <CommunityRow
                c={c}
                active={c.id === activeCommunityId}
                typingText={typingMap.get(c.id)}
                onClick={() => handleNavigate(c.id)}
              />
              {showChannels && (
                <li className="mt-1 mb-1.5">
                  <div className="flex items-center justify-between px-3 pb-0.5">
                    <span className="font-body text-[8px] font-semibold uppercase tracking-widest text-foreground-muted/70">
                      Channels
                    </span>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => setManageCommunityId(c.id)}
                        className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                        aria-label={`Manage channels in ${c.name}`}
                        title="Manage channels"
                      >
                        <Plus size={11} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {communityChannels.map((ch) => (
                      <ChannelRow
                        key={ch.id}
                        channel={ch}
                        active={c.id === activeCommunityId && activeChannelId === ch.id}
                        onClick={() => openCommunity(c.id, ch.id)}
                      />
                    ))}
                    {isOwner && communityChannels.length === 0 && (
                      <li className="px-3 pb-1 font-body text-[11px] text-foreground-muted/70">
                        No channels yet
                      </li>
                    )}
                  </ul>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>

      {manageCommunity && (
        <ChannelManagerModal
          open
          onClose={() => setManageCommunityId(null)}
          channels={channels}
          loading={channelsLoading}
          activeChannelId={activeChannelId}
          createChannel={createChannel}
          renameChannel={renameChannel}
          deleteChannel={deleteChannel}
          onDeleted={(deletedId) => {
            if (activeChannelId === deletedId) {
              router.push(`/dashboard/communities/${manageCommunity.id}`);
            }
          }}
        />
      )}
    </>
  );
}

export function GlobalSidebar({ userId, mobile = false }: Props) {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);

  const {
    communities,
    loading,
    activeCommunityId,
    typingMap,
    handleNavigate,
    router,
  } = useSidebarCommunities(userId);

  const sorted = [...communities].sort((a, b) => {
    // Use the most-recent of: last message or when the user joined.
    // This ensures a freshly joined (or created) community always floats
    // to the top regardless of how old its last message is.
    const ta = [a.last_message?.created_at, a.joined_at].filter(Boolean).sort().at(-1) ?? "";
    const tb = [b.last_message?.created_at, b.joined_at].filter(Boolean).sort().at(-1) ?? "";
    if (tb > ta) return 1;
    if (ta > tb) return -1;
    return a.name.localeCompare(b.name);
  });

  const homeActive =
    isMatch("/dashboard", pathname) &&
    !isMatch("/dashboard/communities", pathname) &&
    !isMatch("/dashboard/chat-with-designers", pathname);
  const exploreActive = pathname === "/dashboard/communities";
  const designersActive = isMatch("/dashboard/chat-with-designers", pathname);

  return (
    <aside
      className={`h-full shrink-0 overflow-y-auto bg-background ${
        mobile ? "w-full" : "w-72 border-r border-border"
      }`}
    >
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
      {/* WORKSPACE nav */}
      <div className="px-4 pt-5 pb-3">
        <p className="px-1 mb-3 font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
          Workspace
        </p>
        <ul className="space-y-1">
          <li>
            <Link
              href="/dashboard"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg font-body text-sm font-medium transition-colors ${
                homeActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Home size={17} className="shrink-0" />
              <span className="flex-1 truncate">Home</span>
              {homeActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
              )}
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/communities"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg font-body text-sm font-medium transition-colors ${
                exploreActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Users size={17} className="shrink-0" />
              <span className="flex-1 truncate">Explore Communities</span>
              {exploreActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
              )}
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/chat-with-designers"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg font-body text-sm font-medium transition-colors ${
                designersActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Gamepad2 size={17} className="shrink-0" />
              <span className="flex-1 truncate">Chat with designers</span>
              {designersActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
              )}
            </Link>
          </li>
        </ul>
      </div>

      {/* ALL — community list */}
      <div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : communities.length === 0 ? (
          <div>
            <div className="flex items-center justify-between px-5 pt-3 pb-1">
              <span className="font-body text-[8px] font-semibold uppercase tracking-widest text-foreground-muted">
                Your Community
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                aria-label="Create community"
                title="Create community"
              >
                <Plus size={11} strokeWidth={2.5} />
              </button>
            </div>
            <div className="px-4 py-6 text-center">
              <MessageSquare
                size={24}
                className="mx-auto text-foreground-muted mb-2 opacity-40"
              />
              <p className="font-body text-xs text-foreground-muted">No communities yet</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <span className="font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
                Your Community
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:border-accent hover:text-accent"
                aria-label="Create community"
                title="Create community"
              >
                <Plus size={11} strokeWidth={2.5} />
              </button>
            </div>
            <Suspense fallback={null}>
              <CommunityListSection
                userId={userId}
                communities={sorted}
                activeCommunityId={activeCommunityId}
                typingMap={typingMap}
                handleNavigate={handleNavigate}
                router={router}
              />
            </Suspense>
          </div>
        )}
      </div>
    </aside>
  );
}