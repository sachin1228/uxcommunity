"use client";

// The re-check control for the System Health page.
//
// The page itself is a Server Component that renders a freshly measured report,
// so this button only has to ask for the same render again: `router.refresh()`
// re-runs the server checks and re-streams the result, which keeps one code
// path (apps/web/lib/health/dependencies.ts) behind both the page and the
// /api/admin/health endpoint instead of a second one in the browser.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function RecheckButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground transition-colors hover:border-accent disabled:opacity-60"
    >
      {pending ? <Spinner size={14} /> : <RefreshCw size={14} strokeWidth={2.5} />}
      {pending ? "Checking…" : "Re-check"}
    </button>
  );
}
