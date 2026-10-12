"use client";

import Link from "next/link";
import { Camera, Globe, Linkedin, MapPin, Plus } from "lucide-react";
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
  /** The member's portfolio link — a chip under the bio on read-only surfaces, the live circle beside LinkedIn on the owner's. */
  portfolio?: string;
  /**
   * Opens the add-portfolio prompt. Omitted on read-only surfaces, where the
   * portfolio renders as the chip instead.
   */
  onAddPortfolio?: () => void;
  /**
   * The member's LinkedIn profile URL when saved — the live circle under the
   * city on the owner's surface, a chip after the bio on read-only ones.
   */
  linkedinUrl?: string | null;
  /**
   * Opens the add-LinkedIn prompt for a member with no link saved. Omitted on
   * read-only surfaces.
   */
  onAddLinkedIn?: () => void;
}

/**
 * Normalizes a stored link into something safe to put in `href`, or null when
 * it cannot be one. Values are user-typed, so only http(s) survives — the
 * `https://` prefix is added when the member left the scheme off.
 */
function externalUrl(value: string | null | undefined): string | null {
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
  onAddPortfolio,
  linkedinUrl,
  onAddLinkedIn,
}: ProfileCardProps) {
  const portfolioUrl = externalUrl(portfolio);
  const linkedinProfileUrl = externalUrl(linkedinUrl);
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
        <div className="group relative mx-auto h-24 w-24 shrink-0">
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

        {/* Edit shares the name's row, pinned to the right edge. The name sits
            in an equal-sided grid so it stays centred even with Edit beside
            it; the role line and the city stack centred under it. */}
        <div className="mt-4">
          <div className="grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-3">
            <span aria-hidden="true" />
            <h2 className="min-w-0 truncate text-center font-display text-2xl font-semibold text-foreground">{name}</h2>

            {editProfileHref ? (
              <Link
                href={editProfileHref}
                className="shrink-0 justify-self-end rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
              >
                Edit
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0">
            {/* Seniority and designation on their own line under the name,
                as plain text — no pill, no icon. One “@” joins the role to the
                workplace: the verified company (logo first, leading to its
                page) when set, or the hollow "Add your company" pill when not.
                Truncated so the label stays a single line however long it
                runs. */}
            {(roleLabel || company || onAddCompany) && (
              <p className="mt-1.5 flex min-w-0 items-center justify-center gap-1 font-body text-sm text-foreground-muted">
                {roleLabel && <span className="truncate">{roleLabel}</span>}
                {roleLabel && (company || onAddCompany) && (
                  <span aria-hidden="true">@</span>
                )}
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
                {!company && onAddCompany && (
                  <button
                    type="button"
                    onClick={onAddCompany}
                    className="flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    <Plus strokeWidth={2.5} size={12} />
                    Add your company
                  </button>
                )}
              </p>
            )}

            {/* City — omitted when unset, rather than leaving an empty line
                behind. */}
            {city && (
              <p className="mt-1.5 flex items-center justify-center gap-1.5 font-body text-sm text-foreground-muted">
                <MapPin strokeWidth={2.5} size={14} className="shrink-0" aria-hidden="true" />
                {city}
              </p>
            )}

            {/* LinkedIn and portfolio — the owner's circles: hollow until a
                link is saved (they open the add prompt right here), then live
                buttons out to the member's profile. Read-only surfaces show
                the labeled chips after the bio instead. */}
            {(onAddLinkedIn || onAddPortfolio) && (
              <div className="mt-3 flex items-center justify-center gap-2">
                {onAddLinkedIn &&
                  (linkedinProfileUrl ? (
                    <a
                      href={linkedinProfileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="LinkedIn profile"
                      title="LinkedIn"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      <Linkedin strokeWidth={2.5} size={14} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={onAddLinkedIn}
                      aria-label="Add your LinkedIn"
                      title="Add your LinkedIn"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border bg-surface text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      <Linkedin strokeWidth={2.5} size={14} />
                    </button>
                  ))}
                {onAddPortfolio &&
                  (portfolioUrl ? (
                    <a
                      href={portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Portfolio"
                      title="Portfolio"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      <Globe strokeWidth={2.5} size={14} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={onAddPortfolio}
                      aria-label="Add your portfolio"
                      title="Add your portfolio"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border bg-surface text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      <Globe strokeWidth={2.5} size={14} />
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Bio */}
        {bio && (
          <p className="mx-auto mt-3 max-w-prose text-center font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* The member's outside links as labeled chips — read-only surfaces
            only; the owner's own surface shows the circles in the hero
            instead. */}
        {!onAddLinkedIn && !onAddPortfolio && (linkedinProfileUrl || portfolioUrl) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {linkedinProfileUrl && (
              <a
                href={linkedinProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
              >
                <Linkedin strokeWidth={2.5} size={12} />
                LinkedIn
              </a>
            )}
            {portfolioUrl && (
              <a
                href={portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 font-body text-xs font-medium text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
              >
                <Globe strokeWidth={2.5} size={12} />
                Portfolio
              </a>
            )}
          </div>
        )}

      </div>
    </section>
  );
}
