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
    <div className="flex h-full items-stretch">
      <div className="min-w-0 flex-1 border-r border-border">
        <div className="mb-6 p-6">
          <h1 className="mb-1 font-display text-2xl font-semibold text-foreground">
            Welcome back{name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
        </div>

        <HomePostComposer
          name={name ?? "Designer"}
          avatarUrl={avatarUrl}
          onCreated={() => setRefreshToken((value) => value + 1)}
        />
        <HomeFeed currentUserId={userId} refreshToken={refreshToken} />
      </div>

      <aside className="sticky top-6 hidden w-72 shrink-0 p-4 lg:block">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
      </aside>
    </div>
  );
}