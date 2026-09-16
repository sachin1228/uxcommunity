"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, MapPin, PenLine, Plus, Star, Layers, BadgeCheck } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

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
  interestNames: string[];
  allInterests: { id: string; name: string }[];
  onSaveInterests: (ids: string[]) => Promise<void>;
  postCount: number;
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
  allInterests,
  onSaveInterests,
  postCount,
}: ProfileCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);

  const selectedIds = allInterests
    .filter((i) => interestNames.includes(i.name))
    .map((i) => i.id);

  async function toggleInterest(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    setSavingInterests(true);
    try {
      await onSaveInterests(next);
    } finally {
      setSavingInterests(false);
    }
  }

  // Role line: "Product Designer · Bengaluru" — mirrors the reference layout.
  const roleLine = [jobTitle, city].filter(Boolean).join(" · ");

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

      {/* ── Avatar + name + stats ── */}
      <div className="relative px-5 pb-5">
        <div className="-mt-10 flex items-end justify-between gap-4">
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

          <div className="flex items-start gap-5 pt-3 sm:gap-7">
            <div className="text-right">
              <p className="font-display text-lg font-semibold leading-tight text-foreground">{postCount}</p>
              <p className="font-body text-[11px] text-foreground-muted">Posts</p>
            </div>
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

        {/* Role · city */}
        {(roleLine || sector || experienceLevel) && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-body text-sm text-foreground-muted">
            {jobTitle && (
              <span className="flex items-center gap-1">
                <BadgeCheck strokeWidth={2.5} size={12} className="text-accent" />
                {jobTitle}
              </span>
            )}
            {roleLine && jobTitle && <span aria-hidden="true">·</span>}
            {city && (
              <span className="flex items-center gap-1">
                <MapPin strokeWidth={2.5} size={12} className="text-accent" />
                {city}
              </span>
            )}
            {sector && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1">
                  <Layers strokeWidth={2.5} size={12} className="text-accent" />
                  {sector}
                </span>
              </>
            )}
            {experienceLevel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 capitalize">
                  <Star strokeWidth={2.5} size={12} className="text-accent" />
                  {experienceLevel.replace(/_/g, " ")}
                </span>
              </>
            )}
          </p>
        )}

        {/* Bio */}
        {bio && (
          <p className="mt-3 max-w-prose font-body text-sm leading-relaxed text-foreground-muted">{bio}</p>
        )}

        {/* Interest chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {interestNames.map((n) => (
            <span key={n} className={chipCls}>
              {n}
            </span>
          ))}
          {!pickerOpen && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={savingInterests}
              aria-label="Add interests"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-foreground-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              <Plus strokeWidth={2.5} size={13} />
            </button>
          )}
        </div>

        {pickerOpen && (
          <div className="mt-3 rounded-xl border border-border bg-surface-raised p-3">
            <div className="flex flex-wrap gap-2">
              {allInterests.map((i) => {
                const active = selectedIds.includes(i.id);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => void toggleInterest(i.id)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 font-body text-xs transition-colors ${
                      active
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border bg-surface text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {i.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
