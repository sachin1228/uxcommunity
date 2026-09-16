"use client";

import {
  Camera, Mail, Calendar,
  MapPin, Layers, Star, Lock, BadgeCheck,
  Linkedin, Globe,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

/** Shared style for the editable URL fields on the links card. */
const fieldCls =
  "w-full border-b border-border bg-transparent pb-1 font-body text-xs text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent";

const labelCls =
  "mb-0.5 flex items-center gap-1 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted";

const chipCls =
  "flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground";

interface ProfileCardProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  memberSince: string | null;
  onOpenAvatarPicker: () => void;
  city: string | null;
  sector: string | null;
  experienceLevel: string | null;
  jobTitle: string | null;
}

/**
 * The left half of the profile header: who you are and the identity chips.
 * Everything describing the member lives here; the editable links sit in
 * `ProfileLinksCard` beside it.
 */
export function ProfileCard({
  name, email, avatarUrl, memberSince,
  onOpenAvatarPicker,
  city, sector, experienceLevel, jobTitle,
}: ProfileCardProps) {
  return (
    <section
      aria-label="Profile details"
      className="overflow-hidden rounded-2xl border border-border bg-surface"
    >
      {/* ── Avatar · name · email · since ── */}
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

        {/* Name / email / since — all read-only */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
          <div className="min-w-0">
            <p className={labelCls}>Name</p>
            <p className="truncate font-display text-base font-semibold text-foreground">{name}</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className={labelCls}>
                <Mail strokeWidth={2.5} size={9} /> Email
              </p>
              <p className="truncate font-body text-xs text-foreground-subtle">{email}</p>
            </div>
            {memberSince && (
              <div className="shrink-0">
                <p className={labelCls}>
                  <Calendar strokeWidth={2.5} size={9} /> Since
                </p>
                <p className="font-body text-xs text-foreground-subtle">{memberSince}</p>
              </div>
            )}
          </div>
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

interface ProfileLinksCardProps {
  linkedin: string;
  portfolio: string;
  onLinkedinChange: (v: string) => void;
  onPortfolioChange: (v: string) => void;
}

/** The right half of the profile header: the editable links. */
export function ProfileLinksCard({
  linkedin, portfolio, onLinkedinChange, onPortfolioChange,
}: ProfileLinksCardProps) {
  return (
    <section
      aria-labelledby="profile-links-heading"
      className="rounded-2xl border border-border bg-surface px-5 py-5"
    >
      <h2
        id="profile-links-heading"
        className="font-display text-[15px] font-semibold text-foreground"
      >
        Links
      </h2>

      <div className="mt-4 flex flex-col gap-5">
        <div>
          <label htmlFor="profile-linkedin" className={labelCls}>
            <Linkedin strokeWidth={2.5} size={9} /> LinkedIn
          </label>
          <input
            id="profile-linkedin"
            type="url"
            value={linkedin}
            onChange={(e) => onLinkedinChange(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className={fieldCls}
          />
        </div>
        <div>
          <label htmlFor="profile-portfolio" className={labelCls}>
            <Globe strokeWidth={2.5} size={9} /> Portfolio
          </label>
          <input
            id="profile-portfolio"
            type="url"
            value={portfolio}
            onChange={(e) => onPortfolioChange(e.target.value)}
            placeholder="https://yourportfolio.com"
            className={fieldCls}
          />
        </div>
      </div>
    </section>
  );
}
