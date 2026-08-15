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
    <div className="flex min-h-full items-stretch">
      <div className="min-h-full min-w-0 flex-1 border-r border-border">
        <HomePostComposer
          name={name ?? "Designer"}
          avatarUrl={avatarUrl}
          onCreated={() => setRefreshToken((value) => value + 1)}
        />
        <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
      </div>

      <aside className="sticky top-6 hidden w-72 shrink-0 p-4 xl:block">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
      </aside>
    </div>
  );
}
