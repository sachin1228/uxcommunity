"use client";

import { useRef, useState } from "react";
import { BellRing, Volume2 } from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { useMessageNotificationPreferences } from "@/lib/communities/message-notifications";

interface Props {
  userId: string;
}

function PreferenceSwitch({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="font-body text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 font-body text-xs leading-relaxed text-foreground-muted">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
          checked ? "border-accent bg-accent" : "border-border bg-surface"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-foreground shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function MessageNotificationSettings({ userId }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { preferences, permission, setSound, setBrowser } =
    useMessageNotificationPreferences(userId);
  const browserUnavailable = permission === "unsupported" || permission === "denied";
  const browserDescription = permission === "unsupported"
    ? "Not supported by this browser"
    : permission === "denied"
      ? "Blocked in browser site settings"
      : preferences.browser
        ? "Alerts when this tab is in the background"
        : "Alert me while UXCommunity is open";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Message notification settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <BellRing size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[340px] max-w-[calc(100vw-1rem)]"
      >
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Volume2 size={16} className="text-accent" aria-hidden="true" />
            <p className="font-display text-sm font-semibold text-foreground">
              Community chat alerts
            </p>
          </div>
          <p className="mt-1 font-body text-xs leading-relaxed text-foreground-muted">
            Choose how new community messages get your attention.
          </p>
        </div>
        <div className="divide-y divide-border">
          <PreferenceSwitch
            checked={preferences.sound}
            label="Message sounds"
            description="Play a short chime for new messages"
            onChange={(enabled) => void setSound(enabled)}
          />
          <PreferenceSwitch
            checked={preferences.browser}
            disabled={browserUnavailable}
            label="Browser notifications"
            description={browserDescription}
            onChange={(enabled) => void setBrowser(enabled)}
          />
        </div>
        <p className="border-t border-border px-4 py-2.5 font-body text-[11px] leading-relaxed text-foreground-muted">
          Alerts work while UXCommunity is open in at least one browser tab.
        </p>
      </DropdownMenu>
    </div>
  );
}
