import { Linkedin } from "lucide-react";

/**
 * Connected accounts — deliberately static.
 *
 * No OAuth exists anywhere in the product yet, so this card shows the one
 * connection that is coming (LinkedIn, the source of the experience a job
 * application would autofill from) as a non-interactive row with a "Coming
 * soon" chip. Nothing here is a dead button: there is no control to click at
 * all until the flow exists.
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

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Linkedin strokeWidth={2.5} size={18} className="text-foreground-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-body text-sm font-medium text-foreground">LinkedIn</p>
          <p className="font-body text-xs text-foreground-muted">
            Import your experience and autofill job applications.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 font-body text-[11px] text-foreground-muted">
          Coming soon
        </span>
      </div>
    </section>
  );
}
