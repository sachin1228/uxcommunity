"use client";

import Link from "next/link";
import { Camera, Globe, PenLine, Plus } from "lucide-react";
import { AvatarImg, isGeneratedProfilePicture } from "@/components/ui/AvatarImg";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import type { ProfileCompanyView } from "@/components/companies/types";

interface ProfileCardProps {
  name: string;
  avatarUrl: string | null;
  /** Omitted on read-only surfaces (other members' profiles) — hides the picker overlay. */
  onOpenAvatarPicker?: () => void;
  city: string | null;
  /**
   * Seniority plus designation, already composed for the pill beside the name
   * ("Mid-Level Product Designer"), or null when neither is set.
   */
  roleLabel: string | null;
  bio: string;
  /**
   * The verified company on the profile, or null when none is set. It rides the
   * role line ("Mid-level Product Designer @ Figma") and is changed from
   * Settings > Profile.
   */
  company: ProfileCompanyView | null;
  /**
   * Opens the "Where do you work?" picker for a member with no company yet.
   * Omitted on read-only surfaces and when a company is already set.
   */
  onAddCompany?: () => void;
  /**
   * Where Edit Profile goes — the Settings Profile page, which owns the
   * identity fields and the workplace. Omitted on read-only surfaces.
   */
  editProfileHref?: string;
  /** The member's portfolio link — rendered as a chip on other members' profiles when set. */
  portfolio?: string;
}

/**
 * Normalizes a stored link into something safe to put in `href`, or null when
 * it cannot be one. Values are user-typed, so only http(s) survives — the
 * `https://` prefix is added when the member left the scheme off.
 */
function externalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The profile hero: display picture, name, the role line (with the workplace
 * after an “@”), city line, bio and (on read-only surfaces) the member's links.
 * It carries no cover image and no card chrome of its own —
 * the dotted texture is the page backdrop (`ProfileClient`), so the picture is
 * the only image and everything here sits directly on the page. The identity
 * details behind Edit Profile live on the Settings page
 * (`app/dashboard/settings/profile`).
 */
export function ProfileCard({
  name,
  avatarUrl,
  onOpenAvatarPicker,
  city,
  roleLabel,
  bio,
  company,
  onAddCompany,
  editProfileHref,
  portfolio = "",
}: ProfileCardProps) {
  const portfolioUrl = externalUrl(portfolio);
  // A stored picture that `AvatarImg` refuses to render (a retired generated
  // avatar) is the same as having none: the hero shows its initials instead of
  // an empty frame.
  const hasPicture = Boolean(avatarUrl) && !isGeneratedProfilePicture(avatarUrl);

  // City under the name. The sector is deliberately not shown on the profile
  // (it still shows on communities surfaces); the designation and seniority
  // sit on the line above and the company has its own card below the block,
  // so each kind of detail is stated once.
  return (
    <section aria-label="Profile details">
      <div>
        {/* ── Display picture — the only image in the hero ──

            The frame is a circle, the same shape the picture has everywhere
            else in the app. Without a picture the hero falls back to the
            *same* round initials avatar every other surface shows
            (`AvatarImg`), rather than a flat placeholder of its own — a member
            with no display picture should read the same here as in the
            topbar. */}
        <div className="group relative h-24 w-24 shrink-0">
          {hasPicture ? (
            <div className="h-24 w-24 overflow-hidden rounded-full border border-border bg-accent/20 shadow-lg">
              <AvatarImg
                url={avatarUrl}
                name={name}
                size={96}
                rounded={false}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <AvatarImg url={avatarUrl} name={name} size={96} className="h-24 w-24 shadow-lg" />
          )}
          {onOpenAvatarPicker && (
            <button
              type="button"
              onClick={onOpenAvatarPicker}
              aria-label="Change profile picture"
              title="Change profile picture"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            >
              <Camera strokeWidth={2.5} size={20} />
            </button>
          )}
        </div>

        {/* Name and the role line stack on the left; Edit sits at the right
            edge, level with the last line of that block — the same place the
            reference header keeps its actions. */}
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-semibold text-foreground">{name}</h2>

            {/* Seniority and designation on their own line under the name,
                as plain text — no pill, no icon. The verified workplace rides
                the same line after an “@”, logo first, and leads to the
                company's page. Truncated so it stays a single line however
                long the label runs. */}
            {(roleLabel || company) && (
              <p className="mt-1.5 flex min-w-0 items-center gap-1.5 font-body text-sm text-foreground-muted">
                {roleLabel && <span className="truncate">{roleLabel}</span>}
                {roleLabel && company && <span aria-hidden="true">@</span>}
                {company && (
                  <Link
                    href={`/dashboard/companies/${company.slug}`}
                    title={
                      company.isActive && company.domainVerified && company.domain
                        ? `Verified via ${company.domain}`
                        : undefined
                    }
                    className={`flex min-w-0 items-center gap-1.5 transition-colors hover:text-accent ${
                      company.isActive ? "text-foreground-muted" : "text-foreground-subtle"
                    }`}
                  >
                    <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={16} />
                    <span className="truncate">{company.name}</span>
                    {company.isActive && company.domainVerified && (
                      <VerifiedMark label={false} size="xs" />
                    )}
                  </Link>
                )}
              </p>
            )}

            {/* City — omitted when unset, rather than leaving an empty line
                behind. */}
            {city && (
              <p className="mt-1.5 font-body text-sm text-foreground-muted">{city}</p>
            )}
          </div>

          {editProfileHref && (
            <Link
              href={editProfileHref}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
            >
              <PenLine strokeWidth={2.5} size={11} />
              Edit Profile
            </Link>
          )}
        </div>

        {/* Empty state only: with no workplace set, this hollow pill opens the
            shared "Where do you work?" picker. Once a company is verified it
            shows on the role line above and the pill goes away. */}
        {!company && onAddCompany && (
          <button
            type="button"
            onClick={onAddCompany}
            className="mt-3 flex w-fit items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Plus strokeWidth={2.5} size={12} />
            Add your company
          </button>
        )}

        {/* Bio */}
        {bio && (
          <p className="mt-3 max-w-prose font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* Portfolio — only on other members' profiles, where it is part of
            the point of the page. */}
        {portfolioUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              <Globe strokeWidth={2.5} size={12} />
              Portfolio
            </a>
          </div>
        )}

      </div>
    </section>
  );
}
