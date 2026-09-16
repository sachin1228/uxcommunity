"use client";

import {
  Camera, Calendar,
  MapPin, Layers, Star, Lock, BadgeCheck,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

const labelCls =
  "mb-0.5 flex items-center gap-1 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted";

const chipCls =
  "flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground";

interface ProfileCardProps {
  name: string;
  avatarUrl: string | null;
  onOpenAvatarPicker: () => void;
  city: string | null;
  sector: string | null;
  experienceLevel: string | null;
  jobTitle: string | null;
}

/**
 * The profile header: who you are and the identity chips. Read-only — contact
 * details and the editable links live on the Settings page
 * (`app/dashboard/settings`).
 */
export function ProfileCard({
  name, avatarUrl,
  onOpenAvatarPicker,
  city, sector, experienceLevel, jobTitle,
}: ProfileCardProps) {
  return (
    <section
      aria-label="Profile details"
      className="overflow-hidden rounded-2xl border border-border bg-surface"
    >
      {/* ── Avatar · name ── */}
      <div className="flex items-start gap-5 px-5 py-5">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="h-16 w-16 overflow-hidden rounded-full bg-accent/20 ring-2 ring-border">
            <AvatarImg url={avatarUrl} name={name} size={64} className="h-16 w-16 object-cover" />
          </div>
          <button
            onClick={onOpenAvatarPicker}
            className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-raised px-2.5 py-1 font-body text-[10px] text-foreground-muted transition-all hover:border-accent/40 hover:text-accent"
          >
            <Camera strokeWidth={2.5} size={9} />
            Change photo
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className={labelCls}>Name</p>
          <p className="truncate font-display text-base font-semibold text-foreground">{name}</p>
        </div>
      </div>

      {/* ── Identity chips ── */}
      <div className="border-t border-border px-5 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
            Identity
          </span>
          <span className="flex shrink-0 items-center gap-1 font-body text-[10px] text-foreground-subtle">
            <Lock strokeWidth={2.5} size={9} /> Not editable here
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {city && (
            <span className={chipCls}>
              <MapPin strokeWidth={2.5} size={10} className="shrink-0 text-accent" />{city}
            </span>
          )}
          {sector && (
            <span className={chipCls}>
              <Layers strokeWidth={2.5} size={10} className="shrink-0 text-accent" />{sector}
            </span>
          )}
          {jobTitle && (
            <span className={chipCls}>
              <BadgeCheck strokeWidth={2.5} size={10} className="shrink-0 text-accent" />{jobTitle}
            </span>
          )}
          {experienceLevel && (
            <span className={`${chipCls} capitalize`}>
              <Star strokeWidth={2.5} size={10} className="shrink-0 text-accent" />{experienceLevel.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
