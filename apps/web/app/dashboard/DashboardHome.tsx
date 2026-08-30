"use client";

import { useState } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";

interface DashboardHomeProps {
  userId: string;
}

export function DashboardHome({ userId }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <DashboardSingleColumn>
      <HomeFeedFilters />
      <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
    </DashboardSingleColumn>
  );
}
