"use client";

import { useState } from "react";
import { HomeFeed } from "./HomeFeed";
import { HomePostComposer } from "./HomePostComposer";

interface DashboardHomeProps {
  name: string | null;
  avatarUrl: string | null;
  userId: string;
}

export function DashboardHome({ name, avatarUrl, userId }: DashboardHomeProps) {
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="mx-auto min-h-full w-full max-w-6xl">
      <HomePostComposer
        name={name ?? "Designer"}
        avatarUrl={avatarUrl}
        onCreated={() => setRefreshToken((value) => value + 1)}
      />
      <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
    </div>
  );
}
