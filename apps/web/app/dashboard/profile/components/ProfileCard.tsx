"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Camera, Globe, Linkedin, MapPin, MoreVertical, Plus, ShieldOff } from "lucide-react";
import { AvatarImg, isGeneratedProfilePicture } from "@/components/ui/AvatarImg";
import { DmIcon } from "@/components/ui/DmIcon";
import { CompanyLogo, VerifiedMark } from "@/components/companies/CompanyBadge";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { PendingButton } from "@/components/ui/PendingButton";
import type { ProfileCompanyView } from "@/components/companies/types";
import { dmUrls } from "@/lib/direct-messages/client";

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
  /**
   * The "Message" chip on read-only surfaces — a link into the DM window that
   * get-or-creates the conversation with this member. Omitted on the owner's
   * own surface (you cannot message yourself).
   */
  messageHref?: string;
  /**
   * The read-only surfaces' block control: the ⋯ menu beside the name
   * (Block user / Unblock user) and the blocked-state line the menu flips.
   * Omitted on the owner's own surface.
   */
  blockControls?: {
    memberId: string;
    /** True when the VIEWER has blocked this member. */
    blockedByMe: boolean;
  } | null;
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
 *
 * While the viewer has this member blocked, the hero reduces to the identity
 * the blocked line needs — picture, name, role, city — plus that line and its
 * Unblock. Workplace, bio and links are not rendered, and the page skips the
 * activity tabs behind it.
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
  messageHref,
  blockControls = null,
}: ProfileCardProps) {
  const portfolioUrl = externalUrl(portfolio);
  const linkedinProfileUrl = externalUrl(linkedinUrl);
  // A stored picture that `AvatarImg` refuses to render (a retired generated
  // avatar) is the same as having none: the hero shows its initials instead of
  // an empty frame.
  const hasPicture = Boolean(avatarUrl) && !isGeneratedProfilePicture(avatarUrl);

  // ── Block control (read-only surfaces) ────────────────────────────────────
  // The menu flips with the server state: the POST/DELETE lands, then
  // router.refresh() re-renders the page with the new blockedByMe prop.
  const router = useRouter();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockPending, setBlockPending] = useState<"block" | "unblock" | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const blockedByMe = blockControls?.blockedByMe ?? false;
  // While the viewer has this member blocked the profile reduces to the
  // identity the blocked line needs — picture, name, role, city — so the
  // workplace, bio and links stay out of the render entirely.
  const reducedView = blockedByMe;

  async function setBlocked(block: boolean) {
    if (!blockControls || blockPending) return;
    setBlockPending(block ? "block" : "unblock");
    setBlockError(null);
    try {
      const response = await fetch(
        block ? dmUrls.blocks : `${dmUrls.blocks}?user_id=${blockControls.memberId}`,
        block
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: blockControls.memberId }),
            }
          : { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setBlockError(payload?.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    } catch {
      setBlockError("Network error. Please try again.");
    } finally {
      setBlockPending(null);
    }
  }

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
            ) : blockControls ? (
              /* The read-only surface's control cluster shares the owner's
                 Edit slot: a ⋯ menu holding Block / Unblock. */
              <div className="justify-self-end">
                <button
                  type="button"
                  ref={menuTriggerRef}
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Member options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted transition-colors hover:border-accent/40 hover:text-foreground"
                >
                  <MoreVertical strokeWidth={2.5} size={16} />
                </button>
                <DropdownMenu
                  triggerRef={menuTriggerRef}
                  open={menuOpen}
                  onClose={() => setMenuOpen(false)}
                  align="right"
                  className="min-w-44 p-1"
                >
                  {blockedByMe ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void setBlocked(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-foreground transition-colors hover:bg-white/[0.08]"
                    >
                      <ShieldOff strokeWidth={2.5} size={14} className="shrink-0 text-foreground-muted" />
                      <span>Unblock user</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void setBlocked(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-body text-xs text-red-400 transition-colors hover:bg-red-400/10"
                    >
                      <Ban strokeWidth={2.5} size={14} className="shrink-0" />
                      <span>Block user</span>
                    </button>
                  )}
                </DropdownMenu>
              </div>
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
                runs. The reduced (blocked) view keeps the role but drops the
                “@ workplace” half. */}
            {(roleLabel || (!reducedView && (company || onAddCompany))) && (
              <p className="mt-1.5 flex min-w-0 items-center justify-center gap-1 font-body text-sm text-foreground-muted">
                {roleLabel && <span className="truncate">{roleLabel}</span>}
                {roleLabel && !reducedView && (company || onAddCompany) && (
                  <span aria-hidden="true">@</span>
                )}
                {!reducedView && company && (
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
                {!reducedView && !company && onAddCompany && (
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

        {/* Bio — hidden in the reduced (blocked) view. */}
        {!reducedView && bio && (
          <p className="mx-auto mt-3 max-w-prose text-center font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* The member's outside links as labeled chips — read-only surfaces
            only; the owner's own surface shows the circles in the hero
            instead. Messaging anyone starts here, so the Message chip is the
            first thing in the row — and while the viewer has THIS member
            blocked the row reduces to the blocked line and its way back, with
            the links gone. */}
        {!onAddLinkedIn && !onAddPortfolio && (blockedByMe || messageHref || linkedinProfileUrl || portfolioUrl) && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {blockedByMe ? (
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 font-body text-xs text-foreground-muted">
                <Ban strokeWidth={2.5} size={12} className="shrink-0 text-red-400" aria-hidden="true" />
                You blocked <span className="font-medium text-foreground">{name}</span>. They
                can&apos;t message you or see your profile.
              </span>
            ) : (
              messageHref && (
                <Link
                  href={messageHref}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--ds-blue-800)] px-3 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:bg-[var(--ds-blue-900)]"
                >
                  <DmIcon size={12} />
                  Message
                </Link>
              )
            )}
            {blockedByMe && (
              <PendingButton
                type="button"
                onClick={() => void setBlocked(false)}
                pending={blockPending === "unblock"}
                pendingLabel="Unblocking…"
                spinnerSize={12}
                className="modal-btn modal-btn-secondary h-7 px-3 text-xs"
              >
                Unblock
              </PendingButton>
            )}
            {!reducedView && linkedinProfileUrl && (
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
            {!reducedView && portfolioUrl && (
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

        {blockError && (
          <p role="alert" className="mt-2 text-center font-body text-xs text-red-400">
            {blockError}
          </p>
        )}

      </div>
    </section>
  );
}
