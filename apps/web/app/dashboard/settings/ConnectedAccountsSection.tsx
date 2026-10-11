/**
 * Connected accounts — deliberately empty for now.
 *
 * No OAuth exists anywhere in the product yet, so there is nothing to connect
 * and no control that would be a dead button. LinkedIn, the first account we
 * plan to offer, lives on the Profile settings page until the flow exists.
 */
export function ConnectedAccountsSection() {
  return (
    <section
      aria-labelledby="settings-connected-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <div>
        <h2 id="settings-connected-heading" className="font-display text-[15px] font-semibold text-foreground">
          Connected accounts
        </h2>
        <p className="mt-0.5 font-body text-xs text-foreground-muted">
          Link outside accounts to power applications and your profile.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-background px-4 py-4">
        <p className="font-body text-sm text-foreground-muted">No accounts connected yet.</p>
        <p className="mt-1 font-body text-xs text-foreground-subtle">
          We&apos;ll list them here as they become available.
        </p>
      </div>
    </section>
  );
}
