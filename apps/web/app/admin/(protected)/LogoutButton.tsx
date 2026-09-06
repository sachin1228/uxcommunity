"use client";

import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

export function LogoutButton() {
  const { loggingOut, handleLogout } = useLogout();

  return (
    <>
      {loggingOut && <BrandedLoadingScreen label="Logging out" />}
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="rounded-md border border-border px-3 py-1.5 font-body text-xs text-muted-foreground hover:text-foreground hover:bg-popover transition-colors disabled:opacity-60"
      >
        {loggingOut ? "…" : "Sign out"}
      </button>
    </>
  );
}