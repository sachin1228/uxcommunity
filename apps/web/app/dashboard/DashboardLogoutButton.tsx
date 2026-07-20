"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DashboardLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Clear all module-level caches so the next user who logs in on this
      // tab never sees data belonging to the current user.
      const { clearAllUserCaches } = await import("@/lib/communities/cache");
      clearAllUserCaches();
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="rounded-md px-3 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-60"
    >
      {loading ? "…" : "Sign out"}
    </button>
  );
}
