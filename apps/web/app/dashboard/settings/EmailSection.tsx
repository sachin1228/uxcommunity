"use client";

import { useState } from "react";
import { ToggleRow } from "@/components/ui/ToggleRow";
import type { EmailPreferences } from "@/lib/settings/preferences";
import { SaveStatus, type SaveState } from "./SaveStatus";

interface EmailSectionProps {
  email: string;
  initial: EmailPreferences;
}

/**
 * Email — the three optional email streams, stored on the same
 * `notification_preferences` row as the chat switches and saved through the
 * same partial PATCH, one key per change with the control reverting on
 * failure (same rule as NotificationsSection: revert only while the field
 * still holds the attempted value).
 *
 * Nothing on this card changes what email-sending code does today — it only
 * records the member's choice, so future sends can respect it.
 */
export function EmailSection({ email, initial }: EmailSectionProps) {
  const [prefs, setPrefs] = useState<EmailPreferences>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function save(patch: Partial<EmailPreferences>) {
    const previous = prefs;
    setPrefs((current) => ({ ...current, ...patch }));
    setSaveState("saving");
    try {
      const res = await fetch("/api/push/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaveState("saved");
    } catch {
      setPrefs((current) => {
        const reverted = { ...current };
        for (const key of Object.keys(patch) as (keyof EmailPreferences)[]) {
          if (reverted[key] === patch[key]) {
            reverted[key] = previous[key] as never;
          }
        }
        return reverted;
      });
      setSaveState("error");
    }
  }

  return (
    <section aria-labelledby="settings-email-heading" className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="settings-email-heading" className="font-display text-[15px] font-semibold text-foreground">
            Email
          </h2>
          <p className="mt-0.5 truncate font-body text-xs text-foreground-muted" title={email}>
            Sent to {email}.
          </p>
        </div>
        <SaveStatus state={saveState} />
      </div>

      {/* -mx-4 cancels ToggleRow's built-in px-4 so row text lands on the
          card's 20px content edge, flush with the heading; ToggleRow itself
          stays untouched. */}
      <div className="-mx-4 divide-y divide-border">
        <ToggleRow
          title="Job application updates"
          description="Shortlist and decision emails for roles you apply to."
          checked={prefs.emailJobUpdates}
          onChange={(checked) => void save({ emailJobUpdates: checked })}
        />
        <ToggleRow
          title="Community activity"
          description="Invitations and highlights from communities you're in."
          checked={prefs.emailCommunityActivity}
          onChange={(checked) => void save({ emailCommunityActivity: checked })}
        />
        <ToggleRow
          title="Product news"
          description="Occasional updates about new features."
          checked={prefs.emailProductNews}
          onChange={(checked) => void save({ emailProductNews: checked })}
        />
      </div>

      <p className="font-body text-xs text-foreground-muted">
        Account emails (password resets, sign-in) always send.
      </p>
    </section>
  );
}
