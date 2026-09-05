"use client";

import { useState } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeSidebar } from "./HomeSidebar";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";

interface DashboardHomeProps {
  userId: string;
}

export function DashboardHome({ userId }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
      <DashboardSingleColumn>
        <HomeFeedFilters />
        <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
      </DashboardSingleColumn>
      <HomeSidebar />
    </div>
  );
}
