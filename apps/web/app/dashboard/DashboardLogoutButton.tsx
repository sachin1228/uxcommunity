"use client";
import { Button } from "@/components/ui/shadcn/button";


import { BrandedLoadingScreen } from "@/components/ui/BrandedLoadingScreen";
import { useLogout } from "@/components/ui/useLogout";

export function DashboardLogoutButton() {
  const { loggingOut, handleLogout } = useLogout();

  return (
    <>
      {loggingOut && <BrandedLoadingScreen label="Logging out" />}
      <Button variant="ghost"
        onClick={handleLogout}
        disabled={loggingOut}
        className="px-3 py-1.5 transition-colors disabled:opacity-60"
      >
        {loggingOut ? "…" : "Sign out"}
      </Button>
    </>
  );
}