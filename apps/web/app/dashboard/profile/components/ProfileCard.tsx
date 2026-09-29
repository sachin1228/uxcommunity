"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Building2, Camera, MapPin, PenLine, Star, Layers, BadgeCheck, Plus } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { VerifiedMark } from "@/components/companies/CompanyBadge";
import type { ProfileCompanyView } from "@/components/companies/types";

const chipCls =
  "flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground";

interface ProfileCardProps {
  name: string;
  avatarUrl: string | null;
  /** Cover image for the hero. Falls back to the gradient when null. */
  bannerUrl: string | null;
  onOpenAvatarPicker: () => void;
  onOpenBannerPicker: () => void;
  city: string | null;
  sector: string | null;
  experienceLevel: string | null;
  jobTitle: string | null;
  bio: string;
  /** Read-only topic chips; topics are picked during onboarding. */
  interestNames: string[];
  /** The verified company on the profile, or null when none is set. */
  company: ProfileCompanyView | null;
  /** Opens the company picker — the same flow as the one on Settings. */
  onAddCompany: () => void;
}

/**
 * The profile hero: banner, overlapping avatar, name, role/city line, bio,
 * interest chips and a compact stats block. Contact details and links live on
 * the Settings page (`app/dashboard/settings`).
 */
export function ProfileCard({
  name,
  avatarUrl,
  bannerUrl,
  onOpenAvatarPicker,
  onOpenBannerPicker,
  city,
  sector,
  experienceLevel,
  jobTitle,
  bio,
  interestNames,
  company,
  onAddCompany,
}: ProfileCardProps) {
  // Role line: "Product Designer · Figma · Pune · …" — mirrors the reference
  // layout. The company sits right after the role, and when there is none the
  // same slot invites the member to add one instead.
  const roleParts: React.ReactNode[] = [];

  if (jobTitle) {
    roleParts.push(
      <span key="role" className="flex items-center gap-1">
        <BadgeCheck strokeWidth={2.5} size={12} className="text-accent" />
        {jobTitle}
      </span>
    );
  }

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

  if (experienceLevel) {
    roleParts.push(
      <span key="experience" className="flex items-center gap-1 capitalize">
        <Star strokeWidth={2.5} size={12} className="text-accent" />
        {experienceLevel.replace(/_/g, " ")}
      </span>
    );
  }

  return (
    <section
      aria-label="Profile details"
      className="overflow-hidden rounded-2xl border border-border bg-surface"
    >
      {/* ── Banner — the member's cover image, or the gradient placeholder ── */}
      <div className="relative h-32 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-orange-400 sm:h-36">
        {bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bannerUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={onOpenBannerPicker}
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-white/25 bg-black/35 px-3 py-1.5 font-body text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-black/50"
        >
          <Camera strokeWidth={2.5} size={11} />
          {bannerUrl ? "Edit banner" : "Add banner"}
        </button>
      </div>

      {/* ── Avatar + name ── */}
      <div className="relative px-5 pb-5">
        <div className="-mt-10 flex items-end gap-4">
          <div className="group relative shrink-0">
            <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-surface bg-accent/20">
              <AvatarImg url={avatarUrl} name={name} size={72} className="h-full w-full object-cover" />
            </div>
            {/* The avatar keeps its own upload — the banner is a separate image. */}
            <button
              type="button"
              onClick={onOpenAvatarPicker}
              aria-label="Change profile picture"
              title="Change profile picture"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            >
              <Camera strokeWidth={2.5} size={18} />
            </button>
          </div>
        </div>

        {/* Name */}
        <div className="mt-3 flex items-center gap-3">
          <h2 className="truncate font-display text-xl font-semibold text-foreground">{name}</h2>
          <Link
            href="/dashboard/settings"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
          >
            <PenLine strokeWidth={2.5} size={11} />
            Edit Profile
          </Link>
        </div>

        {/* Role · company · city · sector · level */}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 font-body text-sm text-foreground-muted">
          {roleParts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden="true">·</span>}
              {part}
            </Fragment>
          ))}
        </p>

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
