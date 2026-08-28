"use client";

import { useState } from "react";
import { DashboardSingleColumn } from "./ContentLoader";
import { HomeFeed } from "./HomeFeed";
import { HomeFeedFilters } from "./HomeFeedFilters";
import { HomePostComposer } from "./HomePostComposer";

interface DashboardHomeProps {
  name: string | null;
  avatarUrl: string | null;
  userId: string;
}

export function DashboardHome({ name, avatarUrl, userId }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <DashboardSingleColumn>
      <HomePostComposer
        name={name ?? "Designer"}
        avatarUrl={avatarUrl}
        onCreated={() => setRefreshToken((value) => value + 1)}
      />
      <HomeFeedFilters />
      <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
    </DashboardSingleColumn>
  );
}
