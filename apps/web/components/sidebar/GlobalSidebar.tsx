"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Briefcase, Compass, Home, Library, MessageSquare, Plus, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { CommunityRow } from "@/components/communities/panel/CommunityRow";
import { useSidebarCommunities } from "@/components/communities/panel/useSidebarCommunities";
import { CreateCommunityModal } from "@/components/communities/CreateCommunityModal";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import { useNotifications } from "@/lib/use-notifications";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import {
  dismissBetaNotice as persistBetaNoticeDismissed,
  isBetaNoticeDismissed,
  subscribeBetaNotice,
} from "@/lib/beta-notice";
import { ProfileDropdown } from "@/app/dashboard/ProfileDropdown";
import { fetchAndHydrateCommunityBootstrap } from "@/lib/request-cache";
import { BrowserNotificationInitializer } from "@/app/dashboard/BrowserNotificationInitializer";

/** Where the beta notice sends members. */
const WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/Cidu710nE4J1cXe91u4Eqe";



interface SidebarUser {
  name: string;
  email: string;
  avatarUrl: string | null;
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
  const { unreadCount: notificationCount } = useNotifications(userId);

  // The server renders the notice (it cannot see localStorage); the client
  // swaps in the member's stored choice right after hydration.
  const betaNoticeDismissed = useSyncExternalStore(
    subscribeBetaNotice,
    () => isBetaNoticeDismissed(userId),
    () => false,
  );
  const dismissBetaNotice = useCallback(
    () => persistBetaNoticeDismissed(userId),
    [userId],
  );

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

  // Prefetch bootstrap data on hover so clicking is instant (cache hit).
  const prefetchCommunity = useCallback(
    (communityId: string) => {
      fetchAndHydrateCommunityBootstrap(communityId, userId).catch(() => {});
    },
    [userId],
  );

  const homeActive =
    isMatch("/dashboard", pathname) &&
    !isMatch("/dashboard/communities", pathname) &&
    !isMatch("/dashboard/library", pathname) &&
    !isMatch("/dashboard/jobs", pathname) &&
    !isMatch("/dashboard/notifications", pathname);
  const exploreActive = pathname === "/dashboard/communities";
  const libraryActive = isMatch("/dashboard/library", pathname);
  const jobsActive = isMatch("/dashboard/jobs", pathname);
  const notificationsActive = isMatch("/dashboard/notifications", pathname);

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
      {!mobile && <BrowserNotificationInitializer />}

      <div className="min-h-0 flex-1 overflow-y-auto">
      {!mobile && (
        <div className="flex items-center justify-between px-[13px] pb-[11px] pt-[13px]">
          <BrandLogo iconClassName="h-7 w-7" markOnly />
          <div className="flex items-center gap-1">
            {/* Notifications — opens the dedicated notifications page */}
            <Link
              href="/dashboard/notifications"
              aria-label={notificationCount > 0 ? `${notificationCount} unread notifications` : "Notifications"}
              title="Notifications"
              className="relative flex h-6 w-6 items-center justify-center rounded-full border border-border text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground hover:border-foreground-muted"
            >
              <Bell strokeWidth={2.5} size={12} />
              {notificationCount > 0 && (
                <span
                  className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-semibold leading-[14px] text-white"
                  aria-hidden
                >
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      )}

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
              <Home strokeWidth={2.5} size={15} className="shrink-0" />
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
              <Compass strokeWidth={2.5} size={15} className="shrink-0" />
              <span className="flex-1 truncate">Explore Communities</span>
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/library"
              className={`flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal transition-colors ${
                libraryActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Library strokeWidth={2.5} size={15} className="shrink-0" />
              <span className="flex-1 truncate">Library</span>
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard/jobs"
              className={`flex items-center gap-[11px] rounded-lg px-[11px] py-[7px] font-body text-sm font-normal transition-colors ${
                jobsActive
                  ? "bg-surface-raised text-foreground"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-raised"
              }`}
            >
              <Briefcase strokeWidth={2.5} size={15} className="shrink-0" />
              <span className="flex-1 truncate">Jobs</span>
            </Link>
          </li>
        </ul>

        {/* Beta notice — sits where the retired "Chat with designers" entry
            used to, inviting members to the WhatsApp community. Dismissible
            per member; the cross hides it for good on this browser. */}
        {!betaNoticeDismissed && (
          <div className="mt-3 rounded-lg border border-[#25D366]/25 bg-[#25D366]/[0.08] px-[11px] py-[9px]">
            <div className="flex items-center gap-[7px]">
              <WhatsAppIcon size={13} className="shrink-0 text-[#25D366]" />
              <span className="min-w-0 flex-1 truncate font-body text-[11px] font-semibold text-[#25D366]">
                We&apos;re in beta
              </span>
              <button
                type="button"
                onClick={dismissBetaNotice}
                aria-label="Dismiss beta notice"
                title="Dismiss"
                className="-mr-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[#25D366]/60 transition-colors hover:bg-[#25D366]/15 hover:text-[#25D366] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#25D366]"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
            <p className="mt-[5px] font-body text-[10px] leading-snug text-foreground-muted">
              This is my project. Join our WhatsApp group if you want to provide
              feedback on this app.
            </p>
            <a
              href={WHATSAPP_COMMUNITY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-[7px] flex w-full items-center justify-center rounded-md bg-[#25D366] px-2 py-[6px] font-body text-[11px] font-semibold text-[#0b141a] transition-colors hover:bg-[#1ebe5b]"
            >
              Join now
            </a>
          </div>
        )}
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
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-raised text-foreground-muted transition-colors hover:text-foreground"
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
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-raised text-foreground-muted transition-colors hover:text-foreground"
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
                  onClick={handleNavigate}
                  onHover={prefetchCommunity}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
      </div>

      {/* Profile — pinned to the bottom of the sidebar */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <ProfileDropdown variant="row" {...user} />
      </div>
    </aside>
  );
}
