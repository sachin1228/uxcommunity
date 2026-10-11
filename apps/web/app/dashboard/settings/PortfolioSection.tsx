"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { SaveStatus, type SaveState } from "./SaveStatus";

interface PortfolioSectionProps {
  /** The saved portfolio URL, or "" when none is set. */
  initialUrl: string;
}

/**
 * Portfolio — the member's work link, saved through the same debounced
 * PATCH /api/profile the LinkedIn card uses. The profile hero shows it as the
 * circle beside LinkedIn: hollow until a link is saved, then live.
 */
export function PortfolioSection({ initialUrl }: PortfolioSectionProps) {
  const [url, setUrl] = useState(initialUrl);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    if (url === initialUrl) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        // Trimmed string: the profile route stores "" as null, which is how a
        // cleared link is written.
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolio_url: url.trim() }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [url, initialUrl]);

  return (
    <section
      aria-labelledby="settings-portfolio-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="settings-portfolio-heading" className="font-display text-[15px] font-semibold text-foreground">
            Portfolio
          </h2>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Shows as a button on your profile.
          </p>
        </div>
        <SaveStatus state={saveState} />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
          <Globe strokeWidth={2.5} size={18} className="text-foreground-muted" />
        </div>
        <input
          id="settings-portfolio-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://yourportfolio.com"
          aria-label="Portfolio link"
          className="field"
        />
      </div>
    </section>
  );
}
