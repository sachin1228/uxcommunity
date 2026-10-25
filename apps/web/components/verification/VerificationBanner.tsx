import Link from "next/link";

/**
 * Persistent read-only notice above the dashboard. Approved/unknown states
 * render nothing; pending/rejected accounts keep the same reminder until an
 * admin decision lands.
 */
export function VerificationBanner({ status }: { status: string | null | undefined }) {
  if (!status || status === "approved") return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <p className="font-body text-xs text-foreground">
        Your account is currently read-only. Verify your profile to unlock all features.
      </p>
      <Link
        href="/dashboard/verification"
        className="rounded-md bg-foreground px-3 py-1 font-body text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
      >
        Verify yourself
      </Link>
    </div>
  );
}
