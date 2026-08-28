"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, Library, MessageSquare, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow } from "@/components/communities/panel/CommunityRow";
import { useSidebarCommunities } from "@/components/communities/panel/useSidebarCommunities";
import { CreateCommunityModal } from "@/components/communities/CreateCommunityModal";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { NotificationBell } from "@/app/dashboard/NotificationBell";
import { BrowserNotificationInitializer } from "@/app/dashboard/BrowserNotificationInitializer";
import { ProfileDropdown } from "@/app/dashboard/ProfileDropdown";

interface SidebarUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  initial: string;
}

interface Props {
  userId: string;
  user: SidebarUser;
  mobile?: boolean;
}

function isMatch(href: string, pathname: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

export function GlobalSidebar({ userId, user, mobile = false }: Props) {
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
  // Hidden: "Chat with designers" is no longer shown in the sidebar.
  // const designersActive = isMatch("/dashboard/chat-with-designers", pathname);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col overflow-hidden bg-background ${
        mobile ? "w-full" : "w-64 border-r border-border"
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
      <div className="flex h-[57px] shrink-0 items-center gap-[11px] px-[13px]">
        <ProfileDropdown {...user} />
        <p className="min-w-0 flex-1 truncate font-body text-base font-semibold text-foreground">
          {user.name}
        </p>
        <NotificationBell userId={userId} />
      </div>

      {!mobile && <BrowserNotificationInitializer />}

      <div className="min-h-0 flex-1 overflow-y-auto">
      {/* WORKSPACE nav */}
      <div className="px-[13px] pb-[9px] pt-[13px]">
        <p className="mb-[9px] px-[5px] font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
          Workspace
        </p>
        <ul className="flex flex-col gap-[3px]">
          <li>
            <Link
              href="/dashboard"
              className={`flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal transition-colors ${
                homeActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Home size={15} className="shrink-0" />
              <span className="flex-1 truncate">Home</span>
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/communities"
              className={`flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal transition-colors ${
                exploreActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Compass size={15} className="shrink-0" />
              <span className="flex-1 truncate">Explore Communities</span>
            </Link>
          </li>
          <li>
            <div className="flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal text-foreground-muted">
              <Library size={15} className="shrink-0" />
              <span className="flex-1 truncate">Library</span>
            </div>
          </li>
          <li>
            <div className="flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal text-foreground-muted">
              <Plus size={15} className="shrink-0" />
              <span className="flex-1 truncate">Start a community</span>
            </div>
          </li>
          {/* Hidden: "Chat with designers" is no longer shown in the sidebar.
          <li>
            <Link
              href="/dashboard/chat-with-designers"
              className={`flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal transition-colors ${
                designersActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Gamepad2 size={15} className="shrink-0" />
              <span className="flex-1 truncate">Chat with designers</span>
            </Link>
          </li>
          */}
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
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-[#cccccc]"
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
            <div className="flex items-center justify-between px-[17px] pb-[7px] pt-[9px]">
              <span className="font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
                Your Community
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-black transition-colors hover:bg-[#cccccc]"
                aria-label="Create community"
                title="Create community"
              >
                <Plus size={11} strokeWidth={2.5} />
              </button>
            </div>
            <ul className="flex flex-col gap-[3px] px-[13px]">
              {sorted.map((c) => (
                <CommunityRow
                  key={c.id}
                  c={c}
                  active={c.id === activeCommunityId}
                  typingText={typingMap.get(c.id)}
                  onClick={() => handleNavigate(c.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}
