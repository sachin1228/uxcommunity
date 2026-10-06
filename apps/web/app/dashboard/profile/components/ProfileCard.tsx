"use client";

import { Fragment } from "react";
import Link from "next/link";
import { Building2, Camera, Loader2, PenLine, Plus } from "lucide-react";
import { AvatarImg, isGeneratedProfilePicture } from "@/components/ui/AvatarImg";
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
  /** Opens the company picker: adding when none is set, changing when one is. */
  onEditCompany: () => void;
  /** Takes the verified company off the profile for good. */
  onRemoveCompany: () => void;
  /** True while that removal is in flight. */
  removingCompany: boolean;
  /** Message from a failed removal, shown under the company card. */
  companyError: string | null;
}

/**
 * The profile hero: display picture, name, role line, city/sector line, the
 * company card, bio and interest chips. It carries no cover image and no card
 * chrome of its own —
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
  onEditCompany,
  onRemoveCompany,
  removingCompany,
  companyError,
}: ProfileCardProps) {
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

            With a picture the frame is the rounded square of the reference.
            Without one the hero falls back to the *same* round initials avatar
            every other surface shows (`AvatarImg`), rather than a flat square
            placeholder of its own — a member with no display picture should
            read the same here as in the topbar. */}
        <div className="group relative h-24 w-24 shrink-0">
          {hasPicture ? (
            <div className="h-24 w-24 overflow-hidden rounded-2xl border border-border bg-accent/20 shadow-lg">
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
          <button
            type="button"
            onClick={onOpenAvatarPicker}
            aria-label="Change profile picture"
            title="Change profile picture"
            className={`absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none ${
              hasPicture ? "rounded-2xl" : "rounded-full"
            }`}
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

          <Link
            href="/dashboard/settings"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs font-medium text-foreground transition-colors hover:border-accent/40 hover:text-accent"
          >
            <PenLine strokeWidth={2.5} size={11} />
            Edit Profile
          </Link>
        </div>

        {/* The company has its own card under the identity block, clear of the
            city and sector line. It is also the only place the company can be
            managed now that Settings keeps to contact details and links: the
            card opens the picker to replace it, and Remove sits beside it.

            A deactivated company keeps the name and stays open to replacing,
            but loses the accent and the verified mark: the company behind it is
            not something to advertise any more. */}
        <div className="mt-3">
          {company ? (
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
                <Building2
                  strokeWidth={2.5}
                  size={14}
                  className={`shrink-0 ${company.isActive ? "text-accent" : ""}`}
                />
                <span className="truncate">{company.name}</span>
                {company.isActive && company.domainVerified && (
                  <VerifiedMark label={false} size="xs" />
                )}
              </button>
              <button
                type="button"
                onClick={onRemoveCompany}
                disabled={removingCompany}
                aria-label={`Remove ${company.name} from your profile`}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
              >
                {removingCompany && (
                  <Loader2 strokeWidth={2.5} size={11} className="animate-spin" />
                )}
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onEditCompany}
              className="flex w-fit items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              <Plus strokeWidth={2.5} size={14} />
              Add your company
            </button>
          )}

          {companyError && (
            <p className="mt-2 font-body text-xs text-foreground-muted" role="alert">
              {companyError}
            </p>
          )}
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
