import { getHomeRailData } from "@/lib/home/home-sidebar-server";
import { HomeSidebar } from "./HomeSidebar";

/**
 * Async entry point for the homepage rail.
 *
 * Every surface that shows the rail (the homepage and the public thread /
 * showcase / resource / event detail pages) renders this instead of
 * `HomeSidebar`, so the suggestion list is loaded in exactly one place and
 * always paints with the page.
 */
export async function HomeRail({ userId }: { userId: string }) {
  const { suggested } = await getHomeRailData(userId);
  return <HomeSidebar suggested={suggested} />;
}
