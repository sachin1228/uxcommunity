"use client";

import { useState, type ReactNode } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";

interface DashboardHomeProps {
  userId: string;
  /**
   * The sidebar rail, rendered on the server (HomeRail) and slotted in here so
   * this client shell can own the two-column layout without owning the data.
   */
  rail?: ReactNode;
}

export function DashboardHome({ userId, rail }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
      <DashboardSingleColumn>
        <HomeFeedFilters />
        <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
      </DashboardSingleColumn>
      {rail}
    </div>
  );
}
