"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Camera, Globe, Linkedin, PenLine, Plus } from "lucide-react";
import { AvatarImg, isGeneratedProfilePicture } from "@/components/ui/AvatarImg";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import type { ProfileCompanyView } from "@/components/companies/types";

interface ProfileCardProps {
  name: string;
  avatarUrl: string | null;
  /** Omitted on read-only surfaces (other members' profiles) — hides the picker overlay. */
  onOpenAvatarPicker?: () => void;
  city: string | null;
  sector: string | null;
  /**
   * Seniority plus designation, already composed for the pill beside the name
   * ("Mid-Level Product Designer"), or null when neither is set.
   */
  roleLabel: string | null;
  bio: string;
  /** The verified company on the profile, or null when none is set. */
  company: ProfileCompanyView | null;
  /** Opens the company picker: adding when none is set, changing when one is. Omitted on read-only surfaces, where the company links to its page instead. */
  onEditCompany?: () => void;
  /** Opens the Edit Profile modal (identity details + group swap). Omitted on read-only surfaces. */
  onOpenEditProfile?: () => void;
  /** The member's links — rendered as chips on other members' profiles when set. */
  linkedin?: string;
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
 * The profile hero: display picture, name, role line, city/sector line, the
 * company card, bio and (on read-only surfaces) the member's links. It carries
 * no cover image and no card chrome of its own —
 * the dotted texture is the page backdrop (`ProfileClient`), so the picture is
 * the only image and everything here sits directly on the page. The owner's
 * contact details live on the Settings page (`app/dashboard/settings`).
 */
export function ProfileCard({
  name,
  avatarUrl,
  onOpenAvatarPicker,
  city,
  sector,
  roleLabel,
  bio,
  company,
  onEditCompany,
  onOpenEditProfile,
  linkedin = "",
  portfolio = "",
}: ProfileCardProps) {
  const linkedinUrl = externalUrl(linkedin);
  const portfolioUrl = externalUrl(portfolio);
  // A stored picture that `AvatarImg` refuses to render (a retired generated
  // avatar) is the same as having none: the hero shows its initials instead of
  // an empty frame.
  const hasPicture = Boolean(avatarUrl) && !isGeneratedProfilePicture(avatarUrl);

  // Role line under the name: city and sector, separated by middots. The
  // designation and seniority sit on the line above and the company has its own
  // card below the block, so each kind of detail is stated once.
  const roleParts: React.ReactNode[] = [];

  // Both are plain text: the middot separators carry the line without a glyph
  // in front of each place.
  if (city) {
    roleParts.push(<span key="city">{city}</span>);
  }

  if (sector) {
    roleParts.push(<span key="sector">{sector}</span>);
  }

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
                as plain text — no pill, no icon. Truncated so it always stays
                a single line however long the label runs. */}
            {roleLabel && (
              <p className="mt-1.5 truncate font-body text-sm text-foreground-muted">{roleLabel}</p>
            )}

            {/* City · sector — omitted entirely when neither is set, rather
                than leaving an empty line behind. */}
            {roleParts.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 font-body text-sm text-foreground-muted">
                {roleParts.map((part, index) => (
                  <Fragment key={index}>
                    {index > 0 && <span aria-hidden="true">·</span>}
                    {part}
                  </Fragment>
                ))}
              </p>
            )}
          </div>

          {onOpenEditProfile && (
            <button
              type="button"
              onClick={onOpenEditProfile}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
            >
              <PenLine strokeWidth={2.5} size={11} />
              Edit Profile
            </button>
          )}
        </div>

        {/* The company has its own card under the identity block, clear of the
            city and sector line. It is also the only place the company can be
            managed now that Settings keeps to contact details and links: the
            card opens the picker to replace it and Edit sits beside it.

            There is no Remove: a member changes the workplace on their profile
            rather than dropping it, so the row carries Edit alone.

            A deactivated company keeps the name and stays open to replacing,
            but loses the accent and the verified mark: the company behind it is
            not something to advertise any more. */}
        <div className="mt-3">
          {company ? (
            onEditCompany ? (
              <div className="flex w-fit max-w-full flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onEditCompany}
                  title={
                    company.isActive
                      ? company.domain
                        ? `Verified via ${company.domain} — change it`
                        : "Change company"
                      : "This company is no longer active — add another"
                  }
                  className={`flex min-w-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 font-body text-sm transition-colors hover:border-accent/40 ${
                    company.isActive ? "text-foreground" : "text-foreground-subtle"
                  }`}
                >
                  <CompanyLogo
                    name={company.name}
                    logoUrl={company.logoUrl}
                    size={18}
                    shape="circle"
                  />
                  <span className="truncate">{company.name}</span>
                  {company.isActive && company.domainVerified && (
                    <VerifiedMark label={false} size="xs" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={onEditCompany}
                  aria-label={`Edit the company on your profile: ${company.name}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
                >
                  <PenLine strokeWidth={2.5} size={11} />
                  Edit
                </button>
              </div>
            ) : (
              // Read-only surfaces show the same chip, but it leads to the
              // company's page instead of the picker.
              <Link
                href={`/dashboard/companies/${company.slug}`}
                title={
                  company.isActive && company.domain ? `Verified via ${company.domain}` : undefined
                }
                className={`flex w-fit min-w-0 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 font-body text-sm transition-colors hover:border-accent/40 ${
                  company.isActive ? "text-foreground" : "text-foreground-subtle"
                }`}
              >
                <CompanyLogo
                  name={company.name}
                  logoUrl={company.logoUrl}
                  size={18}
                  shape="circle"
                />
                <span className="truncate">{company.name}</span>
                {company.isActive && company.domainVerified && (
                  <VerifiedMark label={false} size="xs" />
                )}
              </Link>
            )
          ) : onEditCompany ? (
            <button
              type="button"
              onClick={onEditCompany}
              className="flex w-fit items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              <Plus strokeWidth={2.5} size={14} />
              Add your company
            </button>
          ) : null}
        </div>

        {/* Bio */}
        {bio && (
          <p className="mt-3 max-w-prose font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* Links — only on other members' profiles, where they are the point
            of the page. A member edits their own links from Edit Profile. */}
        {(linkedinUrl || portfolioUrl) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {linkedinUrl && (
              <a
                href={linkedinUrl}
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
