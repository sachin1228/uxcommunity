"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Linkedin,
  MapPin,
  X,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { useApplicantDecision } from "@/lib/jobs/use-applicant-decision";
import {
  applicationStatusLabel,
  type ApplicationStatus,
  type JobApplicantDetail,
} from "@/lib/jobs/types";

type DesignSection = "portfolio" | "linkedin" | "resume";

/**
 * The poster's "design mode" for one posting's applications — a page of its
 * own (`/applications/[jobId]/[applicationId]`, opened in a fresh tab by the
 * board's card) that renders the application the way its applicant would
 * present it: the applicant's own details and filled links in the left
 * sidebar, and the chosen link loaded in place on the right — an iframe with
 * nothing between the poster and the page itself. Forced light regardless of
 * the app's theme (the `.design-light` scope re-declares the light tokens):
 * this is the applicant's page, not app chrome.
 *
 * The URL pins the applicant being reviewed — a decision refreshes the data
 * without changing what the poster is looking at — and previous/next move
 * through the posting's applicants by navigation, so the browser's own back
 * button walks the same path. Every loaded page is the link the applicant
 * submitted, nothing invented; the resume loads the same way.
 */
export function DesignModeViewer({
  jobId,
  applicants,
  currentId,
}: {
  jobId: string;
  applicants: JobApplicantDetail[];
  currentId: string;
}) {
  const guard = useGuardedRouter();
  const { decide, pendingId, error } = useApplicantDecision(jobId);
  const index = applicants.findIndex((applicant) => applicant.id === currentId);
  const applicant = applicants[index];
  // The first filled link is the opening page: a resume when one was
  // attached, the portfolio otherwise.
  const [section, setSection] = useState<DesignSection>(() =>
    applicant.resume_url ? "resume" : "portfolio"
  );
  // Decisions made here land in this map the moment the database
  // acknowledges them, so the sidebar reads the new standing immediately
  // while `router.refresh()` re-reads the page's data behind it.
  const [settled, setSettled] = useState<Record<string, ApplicationStatus>>({});

  const status = settled[applicant.id] ?? applicant.status;
  // The section's own link, loaded in place. The resume entry only exists
  // where one was attached, so its fallback is belt-and-braces.
  const sectionUrl =
    section === "portfolio"
      ? applicant.portfolio_url
      : section === "linkedin"
        ? applicant.linkedin_url
        : (applicant.resume_url ?? applicant.portfolio_url);
  // The browser's own PDF viewer takes its opening zoom from the URL
  // fragment, so resume PDFs open at 50%.
  const frameUrl = /\.pdf($|[?#])/i.test(sectionUrl)
    ? `${sectionUrl}#zoom=50`
    : sectionUrl;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= applicants.length) return;
      // Resume only exists where a resume was attached; stepping onto an
      // applicant without one falls back to the first link rather than
      // showing an empty page.
      if (!applicants[next].resume_url) {
        setSection((current) => (current === "resume" ? "portfolio" : current));
      }
      guard.push(`/applications/${jobId}/${applicants[next].id}`);
    },
    [applicants, guard, jobId]
  );

  const leave = useCallback(() => {
    guard.push(`/dashboard/jobs/${jobId}/applicants`);
  }, [guard, jobId]);

  // Escape returns to the applicants board; the arrows browse applicants
  // like any media viewer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
      if (event.key === "ArrowLeft") goTo(index - 1);
      if (event.key === "ArrowRight") goTo(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [goTo, index, leave]);

  function changeStatus(next: ApplicationStatus) {
    void decide(applicant, next, (acknowledged) =>
      setSettled((current) => ({ ...current, [applicant.id]: acknowledged }))
    );
  }

  // One entry per link the applicant filled in — no more, no less, resume
  // first. The sidebar rows and the small-screen strip are the same list.
  const linkItems: { key: DesignSection; label: string; icon: ReactNode }[] = [
    ...(applicant.resume_url
      ? [{ key: "resume" as const, label: "Resume", icon: <FileText strokeWidth={2.5} size={15} /> }]
      : []),
    { key: "portfolio", label: "Portfolio", icon: <Globe strokeWidth={2.5} size={15} /> },
    { key: "linkedin", label: "LinkedIn", icon: <Linkedin strokeWidth={2.5} size={15} /> },
  ];

  const decisionError = error?.id === applicant.id ? error.message : null;

  return (
    <div className="design-light flex h-dvh min-h-0 flex-col bg-background font-body text-foreground">
      <div className="flex min-h-0 flex-1">
        {/* Sidebar — the way out, the applicant's own details, the poster's
            decisions, the pager, and the applicant's filled links at the
            foot. Every control lives on this column, so the right side is
            nothing but the applicant's own page. Below lg this column is
            hidden; the controls ride over the page as a strip instead. */}
        <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-6 py-8 lg:flex">
          <button
            type="button"
            onClick={leave}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-lg px-2 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground"
          >
            <ArrowLeft strokeWidth={2.5} size={15} />
            Back to applicants
          </button>

          <div className="mt-3 flex flex-col items-center px-2 py-2 text-center">
            <AvatarImg
              url={applicant.avatar_url}
              name={applicant.name}
              size={112}
              className="rounded-full object-cover"
            />
            <h2 className="mt-4 font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
              {applicant.name}
            </h2>
            {applicant.role_label && (
              <p className="mt-1.5 font-body text-sm text-foreground-muted">
                {applicant.role_label}
              </p>
            )}
            {applicant.city_name && (
              <p className="mt-2 inline-flex items-center gap-1 font-body text-xs text-foreground-subtle">
                <MapPin strokeWidth={2.5} size={12} />
                {applicant.city_name}
              </p>
            )}
            <p className="mt-1 font-body text-xs text-foreground-subtle">
              Applied {applicant.applied_label}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <DecisionButtons
              status={status}
              pending={pendingId === applicant.id}
              error={decisionError}
              onChange={changeStatus}
            />
          </div>

          {/* Previous / next across the posting's applicants — the pager
              belongs to the reviewing column, not the page being read. */}
          <div className="mt-2 flex h-9 items-center justify-between rounded-lg border border-border">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label="Previous applicant"
              className="flex h-full w-10 cursor-pointer items-center justify-center rounded-l-lg text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
            >
              <ChevronLeft strokeWidth={2.5} size={15} />
            </button>
            <span className="font-body text-xs text-foreground-subtle">
              {index + 1} of {applicants.length}
            </span>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index === applicants.length - 1}
              aria-label="Next applicant"
              className="flex h-full w-10 cursor-pointer items-center justify-center rounded-r-lg text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
            >
              <ChevronRight strokeWidth={2.5} size={15} />
            </button>
          </div>

          <nav aria-label="Application links" className="mt-auto flex flex-col gap-1 pt-8">
            {linkItems.map((item) => (
              <SideLink
                key={item.key}
                active={section === item.key}
                icon={item.icon}
                label={item.label}
                onClick={() => setSection(item.key)}
              />
            ))}
          </nav>
        </aside>

        {/* The page itself. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Below lg the sidebar is hidden, so the way back floats here;
              on desktop it is a row in the sidebar. Esc does the same. */}
          <button
            type="button"
            onClick={leave}
            aria-label="Back to applicants"
            title="Back to applicants"
            className="absolute right-3 top-3 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-foreground-muted shadow-[0_4px_14px_rgba(0,0,0,0.10)] transition-colors hover:bg-accent-soft hover:text-foreground lg:hidden"
          >
            <X strokeWidth={2.5} size={15} />
          </button>

          {/* Below lg the sidebar is hidden, so the links — and the
              decisions — ride in a horizontal strip; the active link
              keeps its label. */}
          <nav
            aria-label="Application links"
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface py-2 pl-3 pr-14 lg:hidden"
          >
            {linkItems.map((item) => {
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  title={item.label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setSection(item.key)}
                  className={
                    active
                      ? "flex h-9 w-max shrink-0 cursor-pointer items-center rounded-full bg-accent px-3 text-accent-foreground shadow-[0_6px_20px_rgba(0,0,0,0.14)]"
                      : "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-accent-soft hover:text-foreground"
                  }
                >
                  {item.icon}
                  {active && (
                    <span className="ml-2 whitespace-nowrap font-body text-xs font-semibold">
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 pl-4">
              <DecisionButtons
                status={status}
                pending={pendingId === applicant.id}
                error={decisionError}
                onChange={changeStatus}
              />
            </div>
          </nav>

          {/* The applicant's own page, loaded in place — nothing between
              the poster and the link they are reading. */}
          <div className="min-h-0 flex-1 bg-surface">
            <iframe
              src={frameUrl}
              title={`${applicant.name} — ${section}`}
              className="h-full w-full border-0"
            />
          </div>

          {/* Below lg the sidebar is hidden, so the pager floats here; on
              desktop it lives in the reviewing column. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 lg:hidden">
            <div className="pointer-events-auto flex h-11 items-center rounded-full border border-border bg-surface px-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                aria-label="Previous applicant"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
              >
                <ChevronLeft strokeWidth={2.5} size={17} />
              </button>
              <span className="max-w-[240px] truncate px-2 font-body text-xs text-foreground-subtle">
                <span className="font-semibold text-foreground">{applicant.name}</span>
                {` · ${index + 1} of ${applicants.length}`}
              </span>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={index === applicants.length - 1}
                aria-label="Next applicant"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
              >
                <ChevronRight strokeWidth={2.5} size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The decision pair — the same standing the board's cluster shows, in the
 * viewer's light styling: the standing is filled, clicking it moves the
 * applicant back to New (the title says so), and the other decision stays
 * one click away for a change of mind.
 */
function DecisionButtons({
  status,
  pending,
  error,
  onChange,
}: {
  status: ApplicationStatus;
  pending: boolean;
  error: string | null;
  onChange: (status: ApplicationStatus) => void;
}) {
  let buttons: ReactNode;

  if (status === "new") {
    buttons = (
      <>
        <button
          type="button"
          onClick={() => onChange("shortlisted")}
          className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 font-body text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          <Check strokeWidth={2.5} size={13} />
          Shortlist
        </button>
        <button
          type="button"
          onClick={() => onChange("rejected")}
          className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-transparent px-3 font-body text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
        >
          <X strokeWidth={2.5} size={13} />
          Reject
        </button>
      </>
    );
  } else {
    const other: ApplicationStatus = status === "shortlisted" ? "rejected" : "shortlisted";
    const activeClass =
      status === "shortlisted"
        ? "border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
        : "border border-red-600 bg-red-600 text-white hover:bg-red-700";
    const otherClass =
      other === "shortlisted"
        ? "border border-emerald-300 bg-transparent text-emerald-700 hover:bg-emerald-50"
        : "border border-red-200 bg-transparent text-red-600 hover:bg-red-50";

    buttons = (
      <>
        <button
          type="button"
          aria-pressed="true"
          title="Move back to New"
          onClick={() => onChange("new")}
          className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 font-body text-xs font-semibold transition-colors ${activeClass}`}
        >
          {status === "shortlisted" ? (
            <Check strokeWidth={2.5} size={13} />
          ) : (
            <X strokeWidth={2.5} size={13} />
          )}
          {applicationStatusLabel(status)}
        </button>
        <button
          type="button"
          onClick={() => onChange(other)}
          className={`inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 font-body text-xs font-semibold transition-colors ${otherClass}`}
        >
          {other === "shortlisted" ? (
            <Check strokeWidth={2.5} size={13} />
          ) : (
            <X strokeWidth={2.5} size={13} />
          )}
          {applicationStatusLabel(other)}
        </button>
      </>
    );
  }

  if (pending) {
    return (
      <span className="col-span-2 flex h-9 basis-full items-center justify-center px-2">
        <Spinner size={14} />
      </span>
    );
  }

  return (
    <>
      {buttons}
      {error && (
        <p
          role="status"
          className="col-span-2 basis-full text-center font-body text-[11px] leading-snug text-red-600"
        >
          {error}
        </p>
      )}
    </>
  );
}

function SideLink({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-3 font-body text-sm transition-colors ${
        active
          ? "bg-accent-soft font-medium text-foreground"
          : "text-foreground-muted hover:bg-accent-soft hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
