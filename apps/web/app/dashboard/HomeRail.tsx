import { getHomeRailData } from "@/lib/home/home-sidebar-server";
import { HomeSidebar } from "./HomeSidebar";

/**
 * Async entry point for the homepage rail.
 *
 * Every surface that shows the rail (the homepage and the public thread /
 * showcase / resource / event detail pages) renders this instead of
 * `HomeSidebar`, so the two lists are loaded in exactly one place and always
 * paint with the page.
 */
export async function HomeRail({ userId }: { userId: string }) {
  const { trending, suggested } = await getHomeRailData(userId);
  return <HomeSidebar trending={trending} suggested={suggested} />;
}
