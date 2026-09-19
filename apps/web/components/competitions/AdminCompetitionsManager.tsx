"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  BellRing,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { StatusChip, WeekBadge } from "@/components/competitions/CompetitionChrome";
import { formatCycleDate } from "@/lib/competitions/cycle";
import type { AdminEntryRow, Competition, CompetitionStats } from "@/lib/competitions/types";

export interface AdminCompetition extends Competition {
  stats: CompetitionStats;
  entries: AdminEntryRow[];
}

interface FormState {
  id: string | null;
  title: string;
  week_number: string;
  description: string;
  category: string;
  difficulty: string;
  problem: string;
  challenge: string;
  deliverable: string;
  dimensions: string;
  judging: string;
  rules: string;
  start_at: string;
  submission_deadline: string;
  voting_deadline: string;
  results_at: string;
  max_entries_per_user: string;
  allow_self_vote: boolean;
  allow_vote_removal: boolean;
  show_live_leaderboard: boolean;
  archived: boolean;
}

/** ISO → the value a `datetime-local` input wants (local wall clock, no zone). */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` → ISO. The browser gives a wall-clock string; Date resolves it in the admin's zone. */
function fromLocalInput(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

function nextWeekTemplate() {
  // Mirror of the server's weekly template, computed in the admin's own
  // timezone so the form opens pre-filled with plausible dates.
  const now = new Date();
  const anchor = new Date(now);
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() - anchor.getDay());
  if (now.getTime() >= anchor.getTime() + 6 * 24 * 60 * 60 * 1000) {
    anchor.setDate(anchor.getDate() + 7);
  }
  const at = (days: number, hours: number) =>
    new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString();

  return {
    start_at: at(0, 0),
    submission_deadline: at(5, 18),
    voting_deadline: at(6, 0),
    results_at: at(6, 0),
  };
}

function emptyForm(weekNumber: number): FormState {
  const template = nextWeekTemplate();
  return {
    id: null,
    title: "",
    week_number: String(weekNumber),
    description: "",
    category: "Product Design",
    difficulty: "intermediate",
    problem: "",
    challenge: "",
    deliverable: "",
    dimensions: "Mobile — 390×844. Export at 2x.",
    judging: "",
    rules: [
      "One submission per person",
      "Design must be original",
      "No AI-generated final designs",
      "Follow the challenge brief",
      "Be respectful when voting and commenting",
      "Submission must be uploaded before the deadline",
    ].join("\n"),
    start_at: toLocalInput(template.start_at),
    submission_deadline: toLocalInput(template.submission_deadline),
    voting_deadline: toLocalInput(template.voting_deadline),
    results_at: toLocalInput(template.results_at),
    max_entries_per_user: "1",
    allow_self_vote: false,
    allow_vote_removal: true,
    show_live_leaderboard: false,
    archived: false,
  };
}

function formFrom(competition: AdminCompetition): FormState {
  return {
    id: competition.id,
    title: competition.title,
    week_number: String(competition.week_number),
    description: competition.description,
    category: competition.category,
    difficulty: competition.difficulty,
    problem: competition.brief.problem ?? "",
    challenge: competition.brief.challenge ?? "",
    deliverable: competition.brief.deliverable ?? "",
    dimensions: competition.brief.dimensions ?? "",
    judging: competition.brief.judging ?? "",
    rules: competition.rules.join("\n"),
    start_at: toLocalInput(competition.start_at),
    submission_deadline: toLocalInput(competition.submission_deadline),
    voting_deadline: toLocalInput(competition.voting_deadline),
    results_at: toLocalInput(competition.results_at),
    max_entries_per_user: String(competition.max_entries_per_user),
    allow_self_vote: competition.voting_rules.allow_self_vote,
    allow_vote_removal: competition.voting_rules.allow_vote_removal,
    show_live_leaderboard: competition.voting_rules.show_live_leaderboard,
    archived: Boolean(competition.archived_at),
  };
}

/**
 * Admin competition management.
 *
 * Two deliberate design choices:
 *
 *   • There is no "status" control. Status is derived from the cycle
 *     timestamps (see lib/competitions/cycle.ts), so an admin schedules a
 *     week and the app works out whether it is upcoming, live or finished.
 *     Archiving is a timestamp too, not a flag.
 *   • Rules are a textarea, one rule per line. They are the most likely thing
 *     to be reworded week to week, and a textarea makes that a five-second edit
 *     instead of a form redesign.
 */
export function AdminCompetitionsManager({ competitions }: { competitions: AdminCompetition[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const nextWeek = useMemo(
    () => competitions.reduce((max, item) => Math.max(max, item.week_number), 0) + 1,
    [competitions],
  );

  async function call(url: string, init: RequestInit, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const result = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null;
      if (!response.ok) {
        setError((result?.error as string) ?? "Something went wrong.");
        return null;
      }
      setMessage((result?.message as string) ?? "Saved.");
      router.refresh();
      return result;
    } catch {
      setError("Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!form) return;
    const payload = {
      title: form.title,
      week_number: Number(form.week_number) || nextWeek,
      description: form.description,
      category: form.category,
      difficulty: form.difficulty,
      brief: {
        problem: form.problem,
        challenge: form.challenge,
        deliverable: form.deliverable,
        dimensions: form.dimensions,
        judging: form.judging,
      },
      rules: form.rules
        .split("\n")
        .map((rule) => rule.trim())
        .filter(Boolean),
      start_at: fromLocalInput(form.start_at),
      submission_deadline: fromLocalInput(form.submission_deadline),
      voting_deadline: fromLocalInput(form.voting_deadline),
      results_at: fromLocalInput(form.results_at),
      max_entries_per_user: Number(form.max_entries_per_user) || 1,
      voting_rules: {
        allow_self_vote: form.allow_self_vote,
        allow_vote_removal: form.allow_vote_removal,
        show_live_leaderboard: form.show_live_leaderboard,
      },
      archived_at: form.archived ? new Date().toISOString() : null,
    };

    const result = form.id
      ? await call(`/api/admin/competitions/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) }, "save")
      : await call("/api/admin/competitions", { method: "POST", body: JSON.stringify(payload) }, "save");

    if (result) setForm(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-xs text-foreground-muted">
          {competitions.length} {competitions.length === 1 ? "cycle" : "cycles"} · status is derived
          from each cycle&apos;s timestamps
        </p>
        <button
          type="button"
          onClick={() => setForm(emptyForm(nextWeek))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 font-body text-xs font-semibold text-accent-foreground shadow-sm"
        >
          <Plus size={14} strokeWidth={2.5} /> New competition
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-signal)]/10 px-3 py-2 font-body text-xs text-[var(--color-signal)]">
          {error}
        </p>
      )}
      {message && !error && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 font-body text-xs text-foreground">{message}</p>
      )}

      {form && (
        <section className="rounded-xl bg-surface-raised p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-foreground">
              {form.id ? "Edit competition" : "New competition"}
            </h2>
            <button
              type="button"
              onClick={() => setForm(null)}
              aria-label="Close"
              className="text-foreground-subtle hover:text-foreground"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <AdminField label="Title" className="sm:col-span-2">
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                className={INPUT}
                placeholder="Design a Better Weather App"
              />
            </AdminField>

            <AdminField label="Week number">
              <input
                value={form.week_number}
                onChange={(event) => setForm({ ...form, week_number: event.target.value })}
                className={INPUT}
                inputMode="numeric"
              />
            </AdminField>

            <AdminField label="Category">
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                className={INPUT}
              />
            </AdminField>

            <AdminField label="Difficulty">
              <select
                value={form.difficulty}
                onChange={(event) => setForm({ ...form, difficulty: event.target.value })}
                className={INPUT}
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </AdminField>

            <AdminField label="Entries per person">
              <input
                value={form.max_entries_per_user}
                onChange={(event) => setForm({ ...form, max_entries_per_user: event.target.value })}
                className={INPUT}
                inputMode="numeric"
              />
            </AdminField>

            <AdminField label="Short description (hero + cards)" className="sm:col-span-2">
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={2}
                className={INPUT}
              />
            </AdminField>

            {(
              [
                ["problem", "The problem"],
                ["challenge", "What to design"],
                ["deliverable", "Deliverable"],
                ["dimensions", "Recommended dimensions"],
                ["judging", "How it's judged"],
              ] as const
            ).map(([key, label]) => (
              <AdminField key={key} label={label} className="sm:col-span-2">
                <textarea
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  rows={2}
                  className={INPUT}
                />
              </AdminField>
            ))}

            <AdminField label="Rules (one per line)" className="sm:col-span-2">
              <textarea
                value={form.rules}
                onChange={(event) => setForm({ ...form, rules: event.target.value })}
                rows={6}
                className={INPUT}
              />
            </AdminField>

            {(
              [
                ["start_at", "Challenge opens"],
                ["submission_deadline", "Submissions close"],
                ["voting_deadline", "Voting closes"],
                ["results_at", "Results published"],
              ] as const
            ).map(([key, label]) => (
              <AdminField key={key} label={label}>
                <input
                  type="datetime-local"
                  value={form[key]}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  className={INPUT}
                />
              </AdminField>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-4">
            <Toggle
              label="Allow voting for your own entry"
              checked={form.allow_self_vote}
              onChange={(value) => setForm({ ...form, allow_self_vote: value })}
            />
            <Toggle
              label="Allow votes to be withdrawn"
              checked={form.allow_vote_removal}
              onChange={(value) => setForm({ ...form, allow_vote_removal: value })}
            />
            <Toggle
              label="Show a live vote-ordered gallery"
              checked={form.show_live_leaderboard}
              onChange={(value) => setForm({ ...form, show_live_leaderboard: value })}
            />
            <Toggle
              label="Archived (moves to history)"
              checked={form.archived}
              onChange={(value) => setForm({ ...form, archived: value })}
            />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy === "save"}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-semibold text-accent-foreground shadow-sm disabled:opacity-50"
            >
              {busy === "save" && <Spinner className="h-4 w-4" />}
              {form.id ? "Save changes" : "Create competition"}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="font-body text-xs font-semibold text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <ul className="flex flex-col gap-3">
        {competitions.map((competition) => (
          <li key={competition.id} className="rounded-xl bg-surface-raised p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <WeekBadge week={competition.week_number} />
                  <StatusChip status={competition.status} />
                </div>
                <p className="mt-1.5 font-display text-sm font-semibold text-foreground">
                  {competition.title}
                </p>
                <p className="mt-0.5 font-body text-[11px] text-foreground-muted">
                  {formatCycleDate(competition.start_at)} → {formatCycleDate(competition.voting_deadline)}
                  {" · "}
                  {competition.stats.entries} entries · {competition.stats.votes} votes ·{" "}
                  {competition.stats.participants} participants
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <ActionButton
                  onClick={() => setForm(formFrom(competition))}
                  icon={<Pencil size={13} strokeWidth={2.5} />}
                  label="Edit"
                />
                <ActionButton
                  onClick={() => setExpanded(expanded === competition.id ? null : competition.id)}
                  icon={expanded === competition.id ? <EyeOff size={13} strokeWidth={2.5} /> : <Eye size={13} strokeWidth={2.5} />}
                  label="Entries"
                />
                <ActionButton
                  onClick={() =>
                    void call(
                      `/api/admin/competitions/${competition.id}/broadcast`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          kind:
                            competition.status === "results" || competition.status === "archived"
                              ? "results"
                              : "started",
                        }),
                      },
                      `broadcast-${competition.id}`,
                    )
                  }
                  icon={<BellRing size={13} strokeWidth={2.5} />}
                  label="Notify"
                  busy={busy === `broadcast-${competition.id}`}
                />
                <ActionButton
                  onClick={() =>
                    void call(
                      `/api/admin/competitions/${competition.id}`,
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          archived_at: competition.archived_at ? null : new Date().toISOString(),
                        }),
                      },
                      `archive-${competition.id}`,
                    )
                  }
                  icon={<Archive size={13} strokeWidth={2.5} />}
                  label={competition.archived_at ? "Unarchive" : "Archive"}
                  busy={busy === `archive-${competition.id}`}
                />
                <ActionButton
                  onClick={() => {
                    if (!window.confirm(`Delete "${competition.title}" and all its entries?`)) return;
                    void call(`/api/admin/competitions/${competition.id}`, { method: "DELETE" }, `delete-${competition.id}`);
                  }}
                  icon={<Trash2 size={13} strokeWidth={2.5} />}
                  label="Delete"
                  danger
                  busy={busy === `delete-${competition.id}`}
                />
              </div>
            </div>

            {expanded === competition.id && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Reason for a removal (kept in the audit trail)"
                    className={`${INPUT} max-w-sm flex-1`}
                  />
                  <p className="font-body text-[11px] text-foreground-subtle">
                    Removals are soft deletes — votes and history survive.
                  </p>
                </div>

                {competition.entries.length === 0 ? (
                  <p className="mt-3 font-body text-xs text-foreground-muted">No entries yet.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {competition.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className={`flex flex-wrap items-center gap-3 rounded-lg bg-background-subtle p-2.5 ${
                          entry.soft_deleted_at ? "opacity-60" : ""
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={entry.cover_image_url}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                          loading="lazy"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body text-xs font-semibold text-foreground">
                            {entry.title}
                          </p>
                          <p className="truncate font-body text-[11px] text-foreground-subtle">
                            {entry.author_name} · {entry.vote_count} votes
                            {entry.soft_deleted_at ? ` · removed: ${entry.soft_deleted_reason ?? ""}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ActionButton
                            onClick={() =>
                              void call(
                                `/api/admin/competitions/${competition.id}/entries`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    entryId: entry.id,
                                    action: entry.is_featured ? "unfeature" : "feature",
                                  }),
                                },
                                `feature-${entry.id}`,
                              )
                            }
                            icon={<Star size={13} strokeWidth={2.5} fill={entry.is_featured ? "currentColor" : "none"} />}
                            label={entry.is_featured ? "Unfeature" : "Feature"}
                            busy={busy === `feature-${entry.id}`}
                          />
                          {entry.soft_deleted_at ? (
                            <ActionButton
                              onClick={() =>
                                void call(
                                  `/api/admin/competitions/${competition.id}/entries`,
                                  { method: "POST", body: JSON.stringify({ entryId: entry.id, action: "restore" }) },
                                  `restore-${entry.id}`,
                                )
                              }
                              icon={<Eye size={13} strokeWidth={2.5} />}
                              label="Restore"
                              busy={busy === `restore-${entry.id}`}
                            />
                          ) : (
                            <ActionButton
                              onClick={() =>
                                void call(
                                  `/api/admin/competitions/${competition.id}/entries`,
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      entryId: entry.id,
                                      action: "soft_delete",
                                      reason: reason || "Removed by an admin",
                                    }),
                                  },
                                  `remove-${entry.id}`,
                                )
                              }
                              icon={<Trash2 size={13} strokeWidth={2.5} />}
                              label="Remove"
                              danger
                              busy={busy === `remove-${entry.id}`}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const INPUT =
  "w-full rounded-lg bg-background-subtle px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-foreground-subtle focus-visible:ring-2 focus-visible:ring-accent/40";

function AdminField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block font-body text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <span className="font-body text-xs text-foreground-muted">{label}</span>
    </label>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  busy = false,
  danger = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-body text-[11px] font-semibold transition-colors disabled:opacity-50 ${
        danger
          ? "text-[var(--color-signal)] hover:bg-[var(--color-signal)]/10"
          : "text-foreground-muted hover:bg-background-subtle hover:text-foreground"
      }`}
    >
      {busy ? <Spinner className="h-3 w-3" /> : icon}
      {label}
    </button>
  );
}
