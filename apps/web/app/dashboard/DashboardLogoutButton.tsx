"use client";

import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

export function DashboardLogoutButton() {
  const { loggingOut, handleLogout } = useLogout();

  return (
    <>
      {loggingOut && <BrandedLoadingScreen label="Logging out" />}
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="rounded-md px-3 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-60"
      >
        {loggingOut ? "…" : "Sign out"}
      </button>
    </>
  );
}