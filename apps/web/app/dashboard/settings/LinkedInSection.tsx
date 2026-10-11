import { Linkedin } from "lucide-react";

/**
 * LinkedIn — the outside account a job application would autofill from, kept
 * with the rest of the profile rather than under Connected accounts.
 *
 * Deliberately static: no OAuth exists anywhere in the product yet, so this is
 * a non-interactive row with a "Coming soon" chip rather than a button with
 * nothing behind it.
 */
export function LinkedInSection() {
  return (
    <section
      aria-labelledby="settings-linkedin-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <h2 id="settings-linkedin-heading" className="font-display text-[15px] font-semibold text-foreground">
        LinkedIn
      </h2>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Linkedin strokeWidth={2.5} size={18} className="text-foreground-muted" />
        </div>
        <p className="min-w-0 flex-1 font-body text-xs text-foreground-muted">
          Import your experience and autofill job applications.
        </p>
        <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 font-body text-[11px] text-foreground-muted">
          Coming soon
        </span>
      </div>
    </section>
  );
}
