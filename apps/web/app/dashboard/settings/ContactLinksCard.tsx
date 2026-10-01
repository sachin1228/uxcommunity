"use client";

import { useEffect, useState } from "react";
import { CalendarRegular, CheckmarkRegular, GlobeRegular, SpinnerIosRegular, MailRegular } from "@fluentui/react-icons";
import { LinkedinIcon } from "@/components/ui/BrandIcons";

const fieldCls =
  "w-full border-b border-border bg-transparent pb-1 font-body text-xs text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent";

const labelCls =
  "mb-0.5 flex items-center gap-1 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted";

/** Read-only row, styled like the editable fields so the card reads as one form. */
function StaticField({ icon: Icon, label, value }: { icon: typeof MailRegular; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className={labelCls}>
        <Icon fontSize={11} /> {label}
      </p>
      <p className="truncate border-b border-border pb-1 font-body text-xs text-foreground-subtle" title={value}>
        {value}
      </p>
    </div>
  );
}

interface ContactLinksCardProps {
  email: string;
  memberSince: string | null;
  initialLinkedIn: string;
  initialPortfolio: string;
}

/**
 * The settings card: contact details plus the links the member controls.
 * Edits persist through PATCH /api/profile with a debounced autosave —
 * the fields settle a moment after typing stops and confirm with a check.
 */
export function ContactLinksCard({
  email,
  memberSince,
  initialLinkedIn,
  initialPortfolio,
}: ContactLinksCardProps) {
  const [linkedin, setLinkedin] = useState(initialLinkedIn);
  const [portfolio, setPortfolio] = useState(initialPortfolio);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (linkedin === initialLinkedIn && portfolio === initialPortfolio) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            linkedin_url: linkedin.trim() || null,
            portfolio_url: portfolio.trim() || null,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [linkedin, portfolio, initialLinkedIn, initialPortfolio]);

  return (
    <section
      aria-labelledby="contact-links-heading"
      className="rounded-2xl border border-border bg-surface px-5 py-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="contact-links-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          Contact &amp; links
        </h2>
        {saveState === "saving" && (
          <span className="flex items-center gap-1.5 font-body text-[11px] text-foreground-muted" role="status">
            <SpinnerIosRegular fontSize={14} className="animate-spin" /> Saving…
          </span>
        )}
        {saveState === "saved" && (
          <span className="flex items-center gap-1.5 font-body text-[11px] text-accent" role="status">
            <CheckmarkRegular fontSize={14} /> Saved
          </span>
        )}
        {saveState === "error" && (
          <span className="font-body text-[11px] text-red-400" role="alert">
            Couldn&apos;t save — try again
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-5">
        <StaticField icon={MailRegular} label="Email" value={email} />
        {memberSince && <StaticField icon={CalendarRegular} label="Since" value={memberSince} />}

        <div className="border-t border-border pt-4">
          <label htmlFor="settings-linkedin" className={labelCls}>
            <LinkedinIcon fontSize={11} /> LinkedIn
          </label>
          <input
            id="settings-linkedin"
            type="url"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className={fieldCls}
          />
        </div>
        <div>
          <label htmlFor="settings-portfolio" className={labelCls}>
            <GlobeRegular fontSize={11} /> Portfolio
          </label>
          <input
            id="settings-portfolio"
            type="url"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            placeholder="https://yourportfolio.com"
            className={fieldCls}
          />
        </div>
      </div>
    </section>
  );
}
