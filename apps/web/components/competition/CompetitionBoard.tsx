"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  Crown,
  ImageUp,
  Inbox,
  Lock,
  PenLine,
  PenTool,
  Vote,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  countdownLabel,
  weekModel,
  type Phase,
  type RailNode,
  type WeekModel,
} from "./week";

/**
 * The Competition page — one design challenge per week.
 *
 * The week's phase comes from `week.ts` and is computed from the clock: the
 * server renders the model at request time (passed in as `serverNow`, so the
 * first paint is correct without JS), then this component re-syncs with the
 * viewer's clock after hydration and re-renders every half minute — minute
 * granularity is all the countdown needs.
 *
 * Everything the week produces is honestly empty: no entries exist until
 * members submit (which the prototype does not wire), so the page shows the
 * sealed panel while submissions run and the empty state otherwise — never
 * invented entries, names or counts.
 */
export function CompetitionBoard({
  serverNow,
  initialModalOpen = false,
}: {
  /** The server's clock at render time — the model's first input. */
  serverNow: number;
  /** Preview-only: opens the entry modal on load (temporary review route). */
  initialModalOpen?: boolean;
}) {
  const [now, setNow] = useState(serverNow);
  const [modalOpen, setModalOpen] = useState(initialModalOpen);

  // Re-sync with the viewer's clock once after hydration (via a macrotask, so
  // the first paint still matches the server), then keep it fresh at half the
  // countdown's granularity. The model is minute-resolution, so a client
  // clock a few seconds off the server's is invisible.
  useEffect(() => {
    const sync = () => setNow(Date.now());
    const kick = window.setTimeout(sync, 0);
    const id = window.setInterval(sync, 30_000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(id);
    };
  }, []);

  const model = weekModel(now);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 lg:px-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Competition
          </h1>
          <p className="mt-1 font-body text-sm text-foreground-muted">
            One design challenge every week — brief Monday, entries close
            Thursday night, winner crowned Sunday.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="modal-btn modal-btn-primary shrink-0"
        >
          <PenLine strokeWidth={2.5} size={14} />
          Submit your design
        </button>
      </header>

      {/* Hero — this week's challenge */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5 lg:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusChip live={model.chipLive}>{model.chip}</StatusChip>
              <span className="font-mono text-xs text-foreground-muted">
                Week {model.weekNumber}
              </span>
              <span className="font-mono text-xs text-foreground-subtle">
                {model.rangeLabel}
              </span>
            </div>
            <p className={`mt-4 ${EYEBROW_CLASS}`}>This week: UI/UX</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
              Design a focus mode
            </h2>
            <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-foreground-muted">
              Every app has a feed fighting for attention. Design a focus mode
              for a mobile app of your choice — one screen, one clear state —
              that helps someone stay in deep work.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["1 screen", "Mobile app", "Any tool"].map((constraint) => (
                <span
                  key={constraint}
                  className="inline-flex items-center rounded-md border border-border px-2 py-1 font-mono text-[11px] leading-none text-foreground-muted"
                >
                  {constraint}
                </span>
              ))}
            </div>
          </div>

          {/* The page's one live accent: the countdown to the phase's deadline */}
          <div className="flex flex-col justify-center lg:border-l lg:border-border lg:pl-6">
            <p className="font-mono text-[2rem] font-medium leading-none text-[var(--ds-amber-700)]">
              {model.countdown}
            </p>
            <p className="mt-2 font-body text-xs text-foreground-muted">
              {model.deadlineLabel}
            </p>
          </div>
        </div>

        {/* Signature element — the Mon→Sun week rail */}
        <div className="mt-6 border-t border-border pt-5">
          <WeekRail model={model} />
        </div>
      </section>

      {/* How it works */}
      <section className="mt-8 border-t border-border pt-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          How it works
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.title}>
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface">
                <step.icon
                  strokeWidth={2.5}
                  size={14}
                  className="text-foreground-muted"
                />
              </div>
              <h3 className="mt-3 font-display text-sm font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-1 font-body text-xs leading-relaxed text-foreground-muted">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* This week's entries */}
      <section className="mt-8 border-t border-border pt-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-foreground">
            This week’s entries
          </h2>
          <span className={ENTRIES_CHIP_CLASS}>{ENTRIES_CHIP[model.phase]}</span>
        </div>
        <EntriesPanel
          phase={model.phase}
          onOpenModal={() => setModalOpen(true)}
        />
      </section>

      {/* Winners */}
      <section className="mt-8 border-t border-border pt-6">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Winners
        </h2>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          One crowned every Sunday.
        </p>
        <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Crown
            strokeWidth={2}
            size={24}
            className="text-[var(--ds-amber-700)]"
          />
          <p className="mt-3 max-w-md font-body text-xs leading-relaxed text-foreground-muted">
            The first winner is crowned this Sunday — their entry takes the top
            slot here, and earns a Winner badge on the profile.
          </p>
        </div>
      </section>

      {/* Rules */}
      <p className="mt-8 border-t border-border pt-6 font-body text-xs text-foreground-muted">
        One entry per member · Entries sealed until voting · Most votes wins —
        ties settled by the community team
      </p>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="How to enter"
      >
        <div className="flex flex-col gap-5">
          <p className="font-body text-sm leading-relaxed text-foreground-muted">
            {model.entriesOpen ? (
              <>
                One entry per member. Designs stay sealed until Friday, then the
                whole week reveals at once and the community votes for the one
                they’d ship. One screen is the whole brief — any tool you like.
              </>
            ) : (
              <>
                Submissions open Monday at 9:00 IST — this is what the entry
                form will look like. One entry per member. One screen is the
                whole brief — any tool you like.
              </>
            )}
          </p>

          {/* A dimmed mock of the entry form — a preview of what submitting
              will look like, not a working form. */}
          <div aria-hidden="true" className="flex flex-col gap-4 opacity-60">
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-7 text-center">
              <ImageUp
                strokeWidth={2}
                size={20}
                className="text-foreground-muted"
              />
              <p className="mt-2 font-body text-sm text-foreground">
                Drop your design here, or click to browse
              </p>
              <p className="mt-0.5 font-body text-xs text-foreground-subtle">
                One screen — any tool.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Title</span>
              <div className="field flex h-8 items-center px-3 font-body text-sm text-foreground-subtle">
                Name your entry
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL_CLASS}>Description</span>
              <div className="field px-3 py-2 font-body text-sm leading-relaxed text-foreground-subtle">
                What it does and why — a few lines on the decisions behind the
                screen.
              </div>
            </div>
          </div>

          <p className="font-body text-xs text-foreground-muted">
            {model.entryDeadlineLabel} — in{" "}
            <span className="font-mono text-foreground">
              {countdownLabel(model.entryDeadlineMs, now)}
            </span>
            .
          </p>

          <p className="font-body text-xs text-foreground-subtle">
            Prototype preview — submissions aren’t wired yet.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="modal-btn modal-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled
              className="modal-btn modal-btn-primary"
            >
              Submit entry
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** The page's single eyebrow recipe — the hero's discipline label. */
const EYEBROW_CLASS =
  "font-mono text-[10px] font-semibold uppercase tracking-widest text-foreground-muted";
const STATUS_CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-[3px] font-mono text-[10px] uppercase tracking-wider";
const ENTRIES_CHIP_CLASS =
  "inline-flex shrink-0 items-center rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground-muted";
const FIELD_LABEL_CLASS = "font-body text-xs font-medium text-foreground";

function StatusChip({
  live,
  children,
}: {
  live: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`${STATUS_CHIP_CLASS} ${live ? "text-foreground" : "text-foreground-muted"}`}
    >
      <span
        aria-hidden="true"
        className={`h-1 w-1 rounded-full ${live ? "bg-foreground" : "bg-foreground-subtle"}`}
      />
      {children}
    </span>
  );
}

const STEPS = [
  {
    icon: CalendarDays,
    title: "Brief drops",
    body: "A new design discipline every Monday: UI, branding, posters, portfolios.",
  },
  {
    icon: PenTool,
    title: "Design & submit",
    body: "One entry per member, due Thursday 23:59 IST. Entries stay sealed until voting opens.",
  },
  {
    icon: Vote,
    title: "Community vote",
    body: "Every entry is revealed at once on Friday. Vote for the one you’d ship.",
  },
  {
    icon: Crown,
    title: "Winner crowned",
    body: "Most votes takes the week — featured here, with a Winner badge on the profile.",
  },
];

const ENTRIES_CHIP: Record<Phase, string> = {
  gap: "Opens Mon 9:00",
  submissions: "Sealed until Friday",
  voting: "Voting open",
  crowning: "Voting closed",
  winner: "Week closed",
};

/**
 * The entries area, adapted to the phase — never inventing entries. While
 * submissions run the week is sealed; every other phase has no entries to
 * show (the prototype is honest about that), each with its own one-line
 * explanation of what happens next.
 */
function EntriesPanel({
  phase,
  onOpenModal,
}: {
  phase: Phase;
  onOpenModal: () => void;
}) {
  if (phase === "submissions") {
    return (
      <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <Lock
          strokeWidth={2}
          size={24}
          className="text-foreground-muted opacity-60"
        />
        <p className="mt-3 font-display text-sm font-semibold text-foreground">
          Entries are sealed until voting opens
        </p>
        <p className="mt-1 max-w-md font-body text-xs leading-relaxed text-foreground-muted">
          Everyone’s designs reveal together on Friday at 00:00 IST, so the
          vote judges the work — not who posted first.
        </p>
        <button
          type="button"
          onClick={onOpenModal}
          className="modal-btn modal-btn-primary mt-4"
        >
          <PenLine strokeWidth={2.5} size={14} />
          Submit your design
        </button>
      </div>
    );
  }

  if (phase === "gap") {
    return (
      <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <Lock
          strokeWidth={2}
          size={24}
          className="text-foreground-muted opacity-60"
        />
        <p className="mt-3 font-display text-sm font-semibold text-foreground">
          Submissions are not open yet
        </p>
        <p className="mt-1 max-w-md font-body text-xs leading-relaxed text-foreground-muted">
          This week’s brief drops Monday at 9:00 IST. Everyone’s designs then
          stay sealed until voting opens on Friday.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <Inbox
        strokeWidth={2}
        size={24}
        className="text-foreground-muted opacity-60"
      />
      <p className="mt-3 font-display text-sm font-semibold text-foreground">
        {phase === "winner" ? "No entries this week" : "No entries landed this week"}
      </p>
      <p className="mt-1 max-w-md font-body text-xs leading-relaxed text-foreground-muted">
        The next brief drops Monday at 9:00 IST.
      </p>
    </div>
  );
}

/**
 * The week rail: Mon→Sun, the four fixed stops on the line, each done /
 * current / upcoming, with a "today" diamond marking where the week actually
 * is. Monochrome by design — the countdown above is the page's ink-on-amber
 * moment, and this stays quiet next to it.
 */
function WeekRail({ model }: { model: WeekModel }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="relative min-w-[26rem]">
        {/* Node labels */}
        <div className="relative h-10">
          {model.rail.map((node) => (
            <div
              key={node.key}
              style={{ left: `${node.center * 100}%` }}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-center"
            >
              <p className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">
                {node.day}
              </p>
              <p
                className={`font-body text-xs leading-4 ${
                  node.state === "current"
                    ? "font-medium text-foreground"
                    : "text-foreground-muted"
                }`}
              >
                {node.label}
              </p>
            </div>
          ))}
        </div>

        {/* Track */}
        <div className="relative h-5">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border"
          />
          <div
            aria-hidden="true"
            style={{ width: `${model.todayProgress * 100}%` }}
            className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-foreground-muted"
          />
          {model.rail.map((node) => (
            <span
              key={node.key}
              aria-hidden="true"
              style={{ left: `${node.center * 100}%` }}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 ${nodeDotClass(node)}`}
            />
          ))}
          {/* Where the week actually is right now */}
          <span
            style={{ left: `${model.todayProgress * 100}%` }}
            className="absolute top-1/2 z-10 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground"
          >
            <span className="sr-only">Today</span>
          </span>
        </div>

        {/* Day axis — today is inked */}
        <div className="mt-1 grid grid-cols-7">
          {days.map((day, index) => (
            <p
              key={day}
              className={`text-center font-mono text-[10px] uppercase tracking-wider ${
                index === model.todayIndex
                  ? "font-semibold text-foreground"
                  : "text-foreground-muted"
              }`}
            >
              {day}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function nodeDotClass(node: RailNode): string {
  if (node.state === "current") {
    // The surface-colored ring punches a clean gap in the line around the dot.
    return "h-[9px] w-[9px] rounded-full bg-foreground ring-4 ring-surface";
  }
  if (node.state === "done") {
    return "h-[7px] w-[7px] rounded-full bg-foreground-muted";
  }
  return "h-[7px] w-[7px] rounded-full border border-border bg-surface";
}
