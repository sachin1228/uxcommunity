"use client";

import { useState } from "react";
import { ToggleRow } from "@/components/ui/ToggleRow";
import type { PushPreferences } from "@/lib/settings/preferences";
import { SaveStatus, type SaveState } from "./SaveStatus";

interface NotificationsSectionProps {
  initial: PushPreferences;
}

/** Anything the input's value can be trusted as a clock ("HH:MM"). */
const TIME_RE = /^\d{2}:\d{2}$/;

/** The IANA zone of the device doing the saving — always available in a browser. */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Notifications — the chat push switches, saved through the partial PATCH on
 * `/api/push/settings` (the same API the mobile app's notifications screen
 * uses, so both surfaces write one row).
 *
 * Each change fires one single-key PATCH — no debounce, a switch settles the
 * instant it moves — and the control reverts on failure: reverting only when
 * the field still holds the attempted value, so a failed early request can
 * never stomp a later successful one.
 *
 * Quiet hours disclose the two clock fields only while enabled — the times
 * are meaningless while the switch is off, and every quiet-hours save carries
 * this device's timezone, because a window evaluated in any other zone fires
 * at the wrong hour for the member.
 */
export function NotificationsSection({ initial }: NotificationsSectionProps) {
  const [prefs, setPrefs] = useState<PushPreferences>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function save(patch: Partial<PushPreferences>, extra?: { quietHoursTimezone: string }) {
    const previous = prefs;
    setPrefs((current) => ({ ...current, ...patch }));
    setSaveState("saving");
    try {
      const res = await fetch("/api/push/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, ...extra }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaveState("saved");
    } catch {
      setPrefs((current) => {
        const reverted = { ...current };
        for (const key of Object.keys(patch) as (keyof PushPreferences)[]) {
          if (reverted[key] === patch[key]) {
            reverted[key] = previous[key] as never;
          }
        }
        return reverted;
      });
      setSaveState("error");
    }
  }

  function saveQuietHours(patch: Partial<PushPreferences>) {
    void save(patch, { quietHoursTimezone: deviceTimeZone() });
  }

  function saveTime(key: "quietHoursStart" | "quietHoursEnd", value: string) {
    // A cleared time input reports ""; it is not a clock yet, so it is left
    // alone instead of being sent to fail the server's HH:MM validation.
    if (!TIME_RE.test(value)) return;
    saveQuietHours({ [key]: value });
  }

  return (
    <section aria-labelledby="settings-notifications-heading" className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="settings-notifications-heading" className="font-display text-[15px] font-semibold text-foreground">
            Notifications
          </h2>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            Chat pushes from your communities.
          </p>
        </div>
        <SaveStatus state={saveState} />
      </div>

      {/* -mx-4 cancels ToggleRow's built-in px-4 so row text (and the
          quiet-hours block inside) lands on the card's 20px content edge,
          flush with the heading; ToggleRow itself stays untouched. */}
      <div className="-mx-4 divide-y divide-border">
        <ToggleRow
          title="Push notifications"
          description="Get push alerts for new chat messages."
          checked={prefs.chatPushEnabled}
          onChange={(checked) => void save({ chatPushEnabled: checked })}
        />
        <ToggleRow
          title="Message sound"
          description="Play a sound with each chat push."
          checked={prefs.chatSound === "default"}
          onChange={(checked) => void save({ chatSound: checked ? "default" : "silent" })}
        />
        <div>
          <ToggleRow
            title="Quiet hours"
            description="Hold chat pushes overnight."
            checked={prefs.quietHoursEnabled}
            onChange={(checked) => saveQuietHours({ quietHoursEnabled: checked })}
          />
          {prefs.quietHoursEnabled && (
            <div className="flex flex-col gap-2 px-4 pb-4">
              <div className="flex items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-body text-xs font-medium text-foreground">From</span>
                  <input
                    type="time"
                    value={prefs.quietHoursStart}
                    onChange={(event) => saveTime("quietHoursStart", event.target.value)}
                    className="field w-[124px]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-body text-xs font-medium text-foreground">To</span>
                  <input
                    type="time"
                    value={prefs.quietHoursEnd}
                    onChange={(event) => saveTime("quietHoursEnd", event.target.value)}
                    className="field w-[124px]"
                  />
                </label>
              </div>
              <p className="font-body text-xs text-foreground-muted">Uses this device&apos;s timezone.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
