"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, Minus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CommunityDp } from "@/components/communities/CommunityDp";
import { CommunityNameBadges, SignupCommunityBadge } from "@/components/communities/CommunityBadges";
import {
  previewGroup,
  slotUnlockDate,
  type IdentityDimension,
  type IdentitySlot,
  type IdentityUpdateResult,
  type OfficialGroup,
  type ProfileIdentityPayload,
} from "@/lib/profile/identity";

/**
 * "Edit profile" — the two-step modal behind the profile hero's Edit button.
 *
 * The details edited here are the ones a member picked at signup (name,
 * job title, experience level, city, sector — never the display picture),
 * and the last four also place them in official communities. So the modal
 * tells BOTH stories at once, live, in every step:
 *
 *   1. form    — the fields, with locked slots disabled under their cooldown;
 *                a Communities panel shows, DP and name, which groups the
 *                current draft would cause them to leave and join;
 *   2. confirm — the old → new values, the same leave/join rows, and the
 *                three-month cost of the change;
 *   3. done    — the server's report of what actually happened.
 *
 * The database is the authority for the cooldown and the swap (one atomic
 * RPC — see update_profile_identity); this component never mutates caches,
 * it reports success upward and the page refreshes behind it.
 */

interface Props {
  open: boolean;
  data: ProfileIdentityPayload;
  onClose: () => void;
  /** Fired once the change was applied, so the page behind can refresh. */
  onSaved: () => void;
}

type Step = "form" | "confirm" | "done";

const slotLabel: Record<IdentitySlot, string> = {
  name: "Name",
  designation: "Designation",
  city: "City",
  sector: "Sector",
};

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // The unlock instant is computed in UTC; display it in the same frame so
    // the date shown is the date stored.
    timeZone: "UTC",
  });
}

/** DP, name and the verified seal — the inside of every group slot. */
function GroupContent({
  name,
  imageUrl,
  type,
  leaving = false,
}: {
  name: string;
  imageUrl: string | null;
  type: IdentityDimension;
  /** The group being left reads muted, struck through (the modal's "old value" language). */
  leaving?: boolean;
}) {
  return (
    <>
      <CommunityDp imageUrl={imageUrl} name={name} size={24} iconSize={12} />
      <span
        className={`flex min-w-0 items-center gap-1 font-body text-xs ${
          leaving ? "text-foreground-muted" : "font-medium text-foreground"
        }`}
      >
        <span className={`truncate ${leaving ? "line-through" : ""}`} title={name}>
          {name}
        </span>
        <CommunityNameBadges type={type} isPrivate={false} size={11} />
      </span>
    </>
  );
}

/** The empty half of a move: no group to leave, or none to join. */
function EmptyContent({ text }: { text: string }) {
  return (
    <>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-accent/25 text-foreground-subtle">
        <Minus strokeWidth={2.5} size={11} />
      </span>
      <span className="font-body text-xs text-foreground-muted">{text}</span>
    </>
  );
}

interface Move {
  dimension: IdentityDimension;
  label: string;
  /** The group the member holds for the current value, when they hold one. */
  leave: OfficialGroup | null;
  /** The group the draft value implies; null when the draft is catch-all "Other". */
  join: { name: string; image_url: string | null } | null;
}

/**
 * The leave → join rows shared by the form preview and the confirm step:
 * a full-width ledger — the field label, then a "Leaving" row and a
 * "Joining" row — so long community names never truncate.
 */
const otherKeepsGeneral = "No group — “Other” keeps you in General";

function MoveLabel({ label }: { label: string }) {
  return (
    <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
      {label}
    </p>
  );
}

function MoveRow({ move }: { move: Move }) {
  return (
    <li>
      <MoveLabel label={move.label} />
      <div className="mt-1.5 overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="w-16 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Leaving
          </span>
          {move.leave ? (
            <GroupContent name={move.leave.name} imageUrl={move.leave.image_url} type={move.dimension} leaving />
          ) : (
            <EmptyContent text="No group held" />
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-accent/10 bg-accent/10 px-3 py-2">
          <span className="w-16 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
            Joining
          </span>
          {move.join ? (
            <GroupContent name={move.join.name} imageUrl={move.join.image_url} type={move.dimension} />
          ) : (
            <EmptyContent text={otherKeepsGeneral} />
          )}
        </div>
      </div>
    </li>
  );
}

function MoveRows({ moves }: { moves: Move[] }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {moves.map((move) => (
        <MoveRow key={move.dimension} move={move} />
      ))}
    </ul>
  );
}

/** "Can change again on …" — the cooldown note under a locked control. */
function LockNote({ until }: { until: string }) {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
      <Lock strokeWidth={2.5} size={10} />
      Can change again on {formatDate(until)}
    </p>
  );
}

export function EditProfileModal({ open, data, onClose, onSaved }: Props) {
  // Mounted only while open (the caller unmounts on close), so the draft is
  // initialised from props once and cannot leak between attempts.
  const [step, setStep] = useState<Step>("form");

  const [name, setName] = useState(data.current.name);
  const [cityId, setCityId] = useState(data.current.city_id ?? "");
  const [sectorId, setSectorId] = useState(data.current.sector_id ?? "");
  const [levelSlug, setLevelSlug] = useState(data.current.experience_level ?? "");
  const [titleSlug, setTitleSlug] = useState(data.current.job_title ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const [result, setResult] = useState<IdentityUpdateResult | null>(null);

  // ── Draft diff ──
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== data.current.name;
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= 100;
  const cityChanged = cityId !== "" && cityId !== (data.current.city_id ?? "");
  const sectorChanged = sectorId !== "" && sectorId !== (data.current.sector_id ?? "");
  const levelChanged = levelSlug !== "" && levelSlug !== (data.current.experience_level ?? "");
  const titleChanged = titleSlug !== "" && titleSlug !== (data.current.job_title ?? "");
  const designationChanged = levelChanged || titleChanged;
  const anyChange = nameChanged || cityChanged || sectorChanged || designationChanged;

  const selectedCity = data.options.cities.find((o) => o.id === cityId) ?? null;
  const selectedSector = data.options.sectors.find((o) => o.id === sectorId) ?? null;
  const selectedLevel = data.options.levels.find((o) => o.id === levelSlug) ?? null;
  const selectedTitle = data.options.titles.find((o) => o.id === titleSlug) ?? null;

  const moves: Move[] = [];
  if (cityChanged) {
    moves.push({
      dimension: "city",
      label: "City",
      leave: data.groups.city,
      join: selectedCity ? previewGroup("city", selectedCity) : null,
    });
  }
  if (sectorChanged) {
    moves.push({
      dimension: "sector",
      label: "Sector",
      leave: data.groups.sector,
      join: selectedSector ? previewGroup("sector", selectedSector) : null,
    });
  }
  if (levelChanged) {
    moves.push({
      dimension: "experience_level",
      label: "Experience level",
      leave: data.groups.experience_level,
      join: selectedLevel ? previewGroup("experience_level", selectedLevel) : null,
    });
  }
  if (titleChanged) {
    moves.push({
      dimension: "job_title",
      label: "Job title",
      leave: data.groups.job_title,
      join: selectedTitle ? previewGroup("job_title", selectedTitle) : null,
    });
  }

  // ── Cooldown locks (dates come pre-filtered to the future) ──
  const lockFor = (slot: IdentitySlot): string | null => data.locks[slot] ?? null;
  const nameLock = lockFor("name");
  const designationLock = lockFor("designation");
  const cityLock = lockFor("city");
  const sectorLock = lockFor("sector");

  const spentSlots: IdentitySlot[] = [];
  if (nameChanged) spentSlots.push("name");
  if (designationChanged) spentSlots.push("designation");
  if (cityChanged) spentSlots.push("city");
  if (sectorChanged) spentSlots.push("sector");

  const canReview = anyChange && nameValid;

  async function handleConfirm() {
    setSubmitting(true);
    setErrorLines([]);

    const payload: Record<string, string> = {};
    if (nameChanged) payload.name = trimmedName;
    if (cityChanged) payload.city_id = cityId;
    if (sectorChanged) payload.sector_id = sectorId;
    if (levelChanged) payload.experience_level = levelSlug;
    if (titleChanged) payload.job_title = titleSlug;

    try {
      const response = await fetch("/api/profile/identity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        locked_fields?: Record<string, string>;
        changed_fields?: IdentitySlot[];
        left_communities?: OfficialGroup[];
        joined_communities?: OfficialGroup[];
      };

      if (!response.ok) {
        if (response.status === 409 && body.error === "profile_field_cooldown") {
          // Another tab (or a change made between render and submit) already
          // spent a slot. Say which one, with its date, and reopen the form.
          const lines = Object.entries(body.locked_fields ?? {}).map(([field, iso]) =>
            `${slotLabel[field as IdentitySlot] ?? field} can be changed again on ${formatDate(iso)}.`
          );
          setErrorLines(
            lines.length ? lines : ["One of these details was changed too recently to change again yet."]
          );
          setStep("form");
          return;
        }
        setErrorLines([body.error ?? "Couldn't save your changes. Please try again."]);
        return;
      }

      setResult({
        changed_fields: body.changed_fields ?? [],
        left_communities: body.left_communities ?? [],
        joined_communities: body.joined_communities ?? [],
      });
      setStep("done");
      onSaved();
    } catch {
      setErrorLines(["Network error. Please try again."]);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldLabelCls =
    "mb-1.5 flex items-center justify-between gap-2 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted";
  const inputCls =
    "w-full rounded-md border border-border bg-surface px-3.5 py-2.5 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-xl" title={step === "done" ? undefined : "Edit profile"}>
      {/* ── 1. The form ── */}
      {step === "form" && (
        <div>
          <p className="-mt-2 mb-5 font-body text-xs text-foreground-muted">
            Step 1 of 2 — pick your details. Changing city, sector or designation moves you between
            the official groups they created; you will confirm on the next step.
          </p>

          {errorLines.length > 0 && (
            <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3" role="alert">
              {errorLines.map((line) => (
                <p key={line} className="font-body text-xs leading-relaxed text-red-400">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-5">
            <div>
              <label htmlFor="edit-profile-name" className={fieldLabelCls}>
                <span>Name</span>
              </label>
              <input
                id="edit-profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={Boolean(nameLock)}
                maxLength={100}
                className={inputCls}
                placeholder="Your name"
              />
              {nameLock ? (
                <LockNote until={nameLock} />
              ) : nameChanged && !nameValid ? (
                <p className="mt-1.5 font-body text-[11px] text-red-400">
                  Name must be at least 2 characters.
                </p>
              ) : null}
            </div>

            <div>
              <p className={fieldLabelCls}>
                <span>Designation</span>
                <span className="normal-case tracking-normal font-normal text-foreground-subtle">
                  job title &amp; experience level count as one change
                </span>
              </p>
              <div className="flex flex-col gap-2.5">
                <SearchableSelect
                  options={data.options.titles.map((o) => ({ value: o.id, label: o.name, imageUrl: o.image_url }))}
                  value={titleSlug}
                  onChange={setTitleSlug}
                  placeholder="Job title"
                  disabled={Boolean(designationLock)}
                />
                <SearchableSelect
                  options={data.options.levels.map((o) => ({ value: o.id, label: o.name, imageUrl: o.image_url }))}
                  value={levelSlug}
                  onChange={setLevelSlug}
                  placeholder="Experience level"
                  disabled={Boolean(designationLock)}
                />
              </div>
              {designationLock && <LockNote until={designationLock} />}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className={fieldLabelCls}>
                  <span>City</span>
                </p>
                <SearchableSelect
                  options={data.options.cities.map((o) => ({ value: o.id, label: o.name, imageUrl: o.image_url }))}
                  value={cityId}
                  onChange={setCityId}
                  placeholder="Select city"
                  disabled={Boolean(cityLock)}
                />
                {cityLock && <LockNote until={cityLock} />}
              </div>
              <div>
                <p className={fieldLabelCls}>
                  <span>Sector</span>
                </p>
                <SearchableSelect
                  options={data.options.sectors.map((o) => ({ value: o.id, label: o.name, imageUrl: o.image_url }))}
                  value={sectorId}
                  onChange={setSectorId}
                  placeholder="Select sector"
                  disabled={Boolean(sectorLock)}
                />
                {sectorLock && <LockNote until={sectorLock} />}
              </div>
            </div>
          </div>

          {/* Live community preview — the groups this draft would move. */}
          <div className="mt-6 rounded-xl border border-border bg-surface-raised px-4 py-3.5">
            <p className="mb-2.5 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
              Communities
            </p>
            {moves.length > 0 ? (
              <>
                <MoveRows moves={moves} />
                <p className="mt-2.5 font-body text-[11px] text-foreground-subtle">
                  {moves.length === 1 ? "This group change happens" : "These group changes happen"} when
                  you confirm — nothing has changed yet.
                </p>
              </>
            ) : (
              <p className="font-body text-xs text-foreground-muted">
                Change a field above to see which communities move with it.
              </p>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={!canReview}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Review changes
              <ArrowRight strokeWidth={2.5} size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── 2. Confirm — values, groups and the three-month cost ── */}
      {step === "confirm" && (
        <div>
          <p className="-mt-2 mb-5 font-body text-xs text-foreground-muted">
            Step 2 of 2 — review what changes. Nothing has been saved yet.
          </p>

          {errorLines.length > 0 && (
            <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3" role="alert">
              {errorLines.map((line) => (
                <p key={line} className="font-body text-xs leading-relaxed text-red-400">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
            {nameChanged && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-28 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Name
                </span>
                <span className="font-body text-sm text-foreground-muted line-through">{data.current.name}</span>
                <ArrowRight strokeWidth={2.5} size={12} className="text-foreground-subtle" />
                <span className="font-body text-sm font-medium text-foreground">{trimmedName}</span>
              </div>
            )}
            {titleChanged && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-28 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Job title
                </span>
                <span className="font-body text-sm text-foreground-muted line-through">
                  {data.options.titles.find((o) => o.id === data.current.job_title)?.name ??
                    data.current.job_title}
                </span>
                <ArrowRight strokeWidth={2.5} size={12} className="text-foreground-subtle" />
                <span className="font-body text-sm font-medium text-foreground">{selectedTitle?.name}</span>
              </div>
            )}
            {levelChanged && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-28 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Experience level
                </span>
                <span className="font-body text-sm text-foreground-muted line-through">
                  {data.options.levels.find((o) => o.id === data.current.experience_level)?.name ??
                    data.current.experience_level}
                </span>
                <ArrowRight strokeWidth={2.5} size={12} className="text-foreground-subtle" />
                <span className="font-body text-sm font-medium text-foreground">{selectedLevel?.name}</span>
              </div>
            )}
            {cityChanged && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-28 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  City
                </span>
                <span className="font-body text-sm text-foreground-muted line-through">
                  {data.options.cities.find((o) => o.id === data.current.city_id)?.name ?? "—"}
                </span>
                <ArrowRight strokeWidth={2.5} size={12} className="text-foreground-subtle" />
                <span className="font-body text-sm font-medium text-foreground">{selectedCity?.name}</span>
              </div>
            )}
            {sectorChanged && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="w-28 shrink-0 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                  Sector
                </span>
                <span className="font-body text-sm text-foreground-muted line-through">
                  {data.options.sectors.find((o) => o.id === data.current.sector_id)?.name ?? "—"}
                </span>
                <ArrowRight strokeWidth={2.5} size={12} className="text-foreground-subtle" />
                <span className="font-body text-sm font-medium text-foreground">{selectedSector?.name}</span>
              </div>
            )}
          </div>

          {moves.length > 0 && (
            <div className="mt-4 rounded-xl border border-border bg-surface-raised px-4 py-3.5">
              <p className="mb-2.5 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                Communities that will change
              </p>
              <MoveRows moves={moves} />
            </div>
          )}

          {/* The cost: each spent slot is locked for three months. */}
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
            <p className="font-body text-xs font-medium text-amber-400">
              {spentSlots.length === 1
                ? `${slotLabel[spentSlots[0]]} can be changed once every 3 months.`
                : "Each of these can be changed once every 3 months."}
            </p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {spentSlots.map((slot) => (
                <li key={slot} className="font-body text-[11px] leading-relaxed text-amber-400/90">
                  {slotLabel[slot]} — next change available on {formatDate(slotUnlockDate(new Date()))}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStep("form")}
              disabled={submitting}
              className="flex items-center gap-1.5 font-body text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft strokeWidth={2.5} size={12} />
              Back to edit
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 strokeWidth={2.5} size={13} className="animate-spin" />}
              Confirm changes
            </button>
          </div>
        </div>
      )}

      {/* ── 3. The server's report ── */}
      {step === "done" && (
        <div className="py-2 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Check strokeWidth={2.5} size={20} />
          </span>
          <h2 className="mt-3 font-display text-lg font-semibold text-foreground">Profile updated</h2>

          {(result?.left_communities.length ?? 0) > 0 || (result?.joined_communities.length ?? 0) > 0 ? (
            <div className="mt-4 flex flex-col gap-3 text-left">
              {(result?.left_communities.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border bg-surface-raised px-4 py-3">
                  <p className="mb-2 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                    Left
                  </p>
                  <ul className="flex flex-col gap-2">
                    {result!.left_communities.map((group) => (
                      <li key={group.id} className="flex items-center gap-2">
                        <CommunityDp imageUrl={group.image_url} name={group.name} size={24} iconSize={12} />
                        <span className="min-w-0 truncate font-body text-sm text-foreground-subtle">
                          {group.name}
                        </span>
                        <SignupCommunityBadge size={11} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(result?.joined_communities.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border bg-surface-raised px-4 py-3">
                  <p className="mb-2 font-body text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                    Joined
                  </p>
                  <ul className="flex flex-col gap-2">
                    {result!.joined_communities.map((group) => (
                      <li key={group.id} className="flex items-center gap-2">
                        <CommunityDp imageUrl={group.image_url} name={group.name} size={24} iconSize={12} />
                        <span className="min-w-0 truncate font-body text-sm text-foreground">
                          {group.name}
                        </span>
                        <SignupCommunityBadge size={11} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 font-body text-sm text-foreground-muted">
              Your communities stay the same.
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-md bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}
