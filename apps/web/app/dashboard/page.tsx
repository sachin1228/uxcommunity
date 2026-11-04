import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DashboardHome } from "./DashboardHome";
import { HomeFeedSkeleton } from "./HomeFeedSkeleton";
import { loadHomeFeedPage } from "@/lib/home/home-feed-server";
import { createServerTimer } from "@/lib/server-timing";
import { HOME_FEED_SCOPE_COOKIE, homeFeedScopeFromCookie } from "@/lib/feeds/home-feed-options";
import type { FeedItem } from "@/components/feeds/types";

export const metadata = { title: "Feed — uxcommunity" };

export default function DashboardPage() {
  return <Suspense fallback={<HomeFeedSkeleton />}><InitialDashboardFeed /></Suspense>;
}

async function InitialDashboardFeed() {
  const timer = createServerTimer("dashboard initial feed");
  const [session, store] = await Promise.all([
    timer.measure("auth", getSession),
    cookies(),
  ]);
  if (!session || session.role !== "user") {
    timer.finish({ status: 401 });
    redirect("/login");
  }
  const userId = session.userId!;
  const scope = homeFeedScopeFromCookie(store.get(HOME_FEED_SCOPE_COOKIE)?.value);
  let initialItems: FeedItem[] | undefined;
  try {
    const items = await timer.measure("feed_page_rpc", () => loadHomeFeedPage(userId, null, scope));
    initialItems = items as unknown as FeedItem[];
    timer.finish({ status: 200, returned_rows: items.length });
  } catch {
    // The client retains its retry/error flow if the server preload fails.
    timer.finish({ status: 500 });
  }
  return <DashboardHome userId={userId} initialScope={scope} initialItems={initialItems} />;
}
