"use client";

import { usePathname } from "next/navigation";
import { ExplorePageSkeleton, JobsPageSkeleton, LibraryPageSkeleton, SavedPageSkeleton } from "@/components/dashboard/PageSkeletons";
import { RouteLoader } from "@/components/ui/RouteLoader";
import { HomeFeedSkeleton } from "./HomeFeedSkeleton";

/** The shared shell can suspend before the destination's loading boundary mounts. */
export function DashboardRouteSkeleton() {
  const pathname = usePathname();
  if (pathname === "/dashboard" || pathname === "/login") return <HomeFeedSkeleton />;
  if (pathname === "/dashboard/communities") return <ExplorePageSkeleton />;
  if (pathname === "/dashboard/library") return <LibraryPageSkeleton />;
  if (pathname === "/dashboard/jobs") return <JobsPageSkeleton />;
  if (pathname === "/dashboard/saved") return <SavedPageSkeleton />;
  return <RouteLoader />;
}
