"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
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
      className="rounded-md border border-overlay-elevated px-3 py-1.5 font-body text-xs text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors disabled:opacity-60"
    >
      {loading ? "…" : "Sign out"}
    </button>
  );
}
