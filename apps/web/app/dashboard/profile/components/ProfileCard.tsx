"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Building2, Camera, MapPin, PenLine, Layers, BadgeCheck, Plus } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { VerifiedMark } from "@/components/companies/CompanyBadge";
import type { ProfileCompanyView } from "@/components/companies/types";

const chipCls =
  "flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground";

interface ProfileCardProps {
  name: string;
  avatarUrl: string | null;
  onOpenAvatarPicker: () => void;
  city: string | null;
  sector: string | null;
  /**
   * Seniority plus designation, already composed for the pill beside the name
   * ("Mid-Level Product Designer"), or null when neither is set.
   */
  roleLabel: string | null;
  bio: string;
  /** Read-only topic chips; topics are picked during onboarding. */
  interestNames: string[];
  /** The verified company on the profile, or null when none is set. */
  company: ProfileCompanyView | null;
  /** Opens the company picker — the same flow as the one on Settings. */
  onAddCompany: () => void;
}

/**
 * The profile hero: display picture, name with the role pill, company/city
 * line, bio and interest chips. It carries no cover image and no card chrome —
 * the dotted texture is the page backdrop (`ProfileClient`), so the picture is
 * the only image and everything here sits directly on the page. Contact details
 * and links live on the Settings page (`app/dashboard/settings`).
 */
export function ProfileCard({
  name,
  avatarUrl,
  onOpenAvatarPicker,
  city,
  sector,
  roleLabel,
  bio,
  interestNames,
  company,
  onAddCompany,
}: ProfileCardProps) {
  // Role line under the name: company, city, sector. The designation and the
  // seniority live in the pill beside the name instead, so the member's role is
  // stated in one place. When there is no company the same slot invites the
  // member to add one.
  const roleParts: React.ReactNode[] = [];

  if (company) {
    // A deactivated company keeps whatever the member already had, but the
    // name is no longer a link and the verified mark is gone: the company
    // behind it is not something to advertise any more.
    roleParts.push(
      <Fragment key="company">
        {company.isActive ? (
          <Link
            href={`/dashboard/companies/${company.slug}`}
            className="flex items-center gap-1 transition-colors hover:text-accent"
            title={company.domain ? `Verified via ${company.domain}` : "Company"}
          >
            <Building2 strokeWidth={2.5} size={12} className="text-accent" />
            {company.name}
          </Link>
        ) : (
          <span
            className="flex items-center gap-1 text-foreground-subtle"
            title="This company is no longer active"
          >
            <Building2 strokeWidth={2.5} size={12} />
            {company.name}
          </span>
        )}
        {company.isActive && company.domainVerified && <VerifiedMark label={false} size="xs" />}
      </Fragment>
    );
  } else {
    roleParts.push(
      <button
        key="add-company"
        type="button"
        onClick={onAddCompany}
        className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
      >
        <Plus strokeWidth={2.5} size={11} />
        Add your company
      </button>
    );
  }

  if (city) {
    roleParts.push(
      <span key="city" className="flex items-center gap-1">
        <MapPin strokeWidth={2.5} size={12} className="text-accent" />
        {city}
      </span>
    );
  }

  if (sector) {
    roleParts.push(
      <span key="sector" className="flex items-center gap-1">
        <Layers strokeWidth={2.5} size={12} className="text-accent" />
        {sector}
      </span>
    );
  }

  return (
    <section aria-label="Profile details">
      <div>
        {/* ── Display picture — the only image in the hero ── */}
        <div className="group relative h-24 w-24 shrink-0">
          <div className="h-24 w-24 overflow-hidden rounded-2xl border border-border bg-accent/20 shadow-lg">
            <AvatarImg
              url={avatarUrl}
              name={name}
              size={96}
              rounded={false}
              className="h-full w-full object-cover"
            />
          </div>
          <button
            type="button"
            onClick={onOpenAvatarPicker}
            aria-label="Change profile picture"
            title="Change profile picture"
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            <Camera strokeWidth={2.5} size={20} />
          </button>
        </div>

        {/* Name and the role line stack on the left; Edit sits at the right
            edge, level with the last line of that block — the same place the
            reference header keeps its actions. */}
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-semibold text-foreground">{name}</h2>

            {/* Seniority and designation on their own line under the name. The
                chip is content-width (`w-fit`) so it stays a pill rather than
                stretching across the column. */}
            {roleLabel && (
              <span className={`${chipCls} mt-2 w-fit`}>
                <BadgeCheck strokeWidth={2.5} size={11} className="text-accent" />
                {roleLabel}
              </span>
            )}

            {/* Company · city · sector */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 font-body text-sm text-foreground-muted">
              {roleParts.map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && <span aria-hidden="true">·</span>}
                  {part}
                </Fragment>
              ))}
            </p>
          </div>

          <Link
            href="/dashboard/settings"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
          >
            <PenLine strokeWidth={2.5} size={11} />
            Edit Profile
          </Link>
        </div>

        {/* Bio */}
        {bio && (
          <p className="mt-3 max-w-prose font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* Interest chips */}
        {interestNames.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {interestNames.map((n) => (
              <span key={n} className={chipCls}>
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
