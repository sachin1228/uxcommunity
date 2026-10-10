"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Home,
  Linkedin,
  MapPin,
  UserRound,
  X,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { ModalPortal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { useApplicantDecision } from "@/lib/jobs/use-applicant-decision";
import {
  applicationStatusLabel,
  type ApplicationStatus,
  type JobApplicantDetail,
  type JobPost,
} from "@/lib/jobs/types";

type DesignSection = "home" | "portfolio" | "linkedin" | "resume" | "profile";

/**
 * The poster's "design mode" for one posting's applications: a full-screen
 * takeover that renders each application the way its applicant would present
 * it — a light-mode portfolio page with the applicant's own details and
 * filled links in the left sidebar, and the section's content on the right.
 * Deliberately light regardless of the app's theme (the `.design-light`
 * scope re-declares the light tokens): this is a preview of the applicant's
 * page, not app chrome.
 *
 * The viewer browses the list it was opened with (a snapshot, so a decision
 * never yanks the current applicant out from under the poster) and carries
 * the same decisions as the board, with the same undo. Every rendered fact is
 * filled-in data — the sections show the links the applicant submitted and
 * the profile facts behind them, nothing invented.
 */
export function DesignModeViewer({
  job,
  applicants,
  onClose,
}: {
  job: JobPost;
  applicants: JobApplicantDetail[];
  onClose: () => void;
}) {
  const guard = useGuardedRouter();
  const { decide, pendingId, error } = useApplicantDecision(job.id);
  const [index, setIndex] = useState(0);
  const [section, setSection] = useState<DesignSection>("home");
  // Decisions made here land in this map the moment the database
  // acknowledges them, so the sidebar reads the new standing immediately
  // while `router.refresh()` catches the board up behind the takeover.
  const [settled, setSettled] = useState<Record<string, ApplicationStatus>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const applicant = applicants[index];
  const status = settled[applicant.id] ?? applicant.status;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= applicants.length) return;
      setIndex(next);
      // Resume only exists where a resume was attached; stepping onto an
      // applicant without one falls back to the first section rather than
      // showing an empty page.
      if (!applicants[next].resume_url) {
        setSection((current) => (current === "resume" ? "home" : current));
      }
    },
    [applicants]
  );

  // Escape closes; the arrows browse applicants like any media viewer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") goTo(index - 1);
      if (event.key === "ArrowRight") goTo(index + 1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [goTo, index, onClose]);

  // Each section (and each applicant) starts at the top of its page.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [index, section]);

  function changeStatus(next: ApplicationStatus) {
    void decide(applicant, next, (acknowledged) =>
      setSettled((current) => ({ ...current, [applicant.id]: acknowledged }))
    );
  }

  function openProfile() {
    onClose();
    guard.push(`/dashboard/profile/${applicant.applicant_id}`);
  }

  // One entry per section — Home plus everything the applicant filled in.
  const sectionItems: { key: DesignSection; label: string; icon: ReactNode }[] = [
    { key: "home", label: "Home", icon: <Home strokeWidth={2.25} size={18} /> },
    { key: "portfolio", label: "Portfolio", icon: <Globe strokeWidth={2.25} size={18} /> },
    { key: "linkedin", label: "LinkedIn", icon: <Linkedin strokeWidth={2.25} size={18} /> },
    ...(applicant.resume_url
      ? [{ key: "resume" as const, label: "Resume", icon: <FileText strokeWidth={2.25} size={18} /> }]
      : []),
    { key: "profile", label: "Profile", icon: <UserRound strokeWidth={2.25} size={18} /> },
  ];

  const decisionError = error?.id === applicant.id ? error.message : null;

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${applicant.name}'s application — design view`}
        className="design-light fixed inset-0 z-[800] flex flex-col bg-background font-body text-foreground"
      >
        {/* Top bar — the way out, the posting this application belongs to,
            and the applicant's links as quick external opens. */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-body text-sm font-medium text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground"
          >
            <ArrowLeft strokeWidth={2.5} size={15} />
            Back to applicants
          </button>

          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="truncate font-body text-xs text-foreground-subtle">
              {job.title}
              <span className="mx-1.5 text-foreground-subtle">·</span>
              {job.company.name}
            </span>
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground-muted">
              Design view
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Small screens have no sidebar, so the decisions ride here. */}
            <div className="flex flex-wrap items-center justify-end gap-2 lg:hidden">
              <DecisionButtons
                status={status}
                pending={pendingId === applicant.id}
                error={decisionError}
                onChange={changeStatus}
              />
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              <HeaderLink href={applicant.portfolio_url} label="Portfolio">
                <Globe strokeWidth={2.25} size={16} />
              </HeaderLink>
              <HeaderLink href={applicant.linkedin_url} label="LinkedIn">
                <Linkedin strokeWidth={2.25} size={16} />
              </HeaderLink>
              {applicant.resume_url && (
                <HeaderLink href={applicant.resume_url} label="Resume">
                  <FileText strokeWidth={2.25} size={16} />
                </HeaderLink>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar — the applicant's own details, the poster's decisions,
              and every section at the foot: Home plus the options the
              applicant filled in, labeled and one click from the poster's
              eye. Below lg this column is hidden; the sections ride in a
              horizontal strip over the page instead. */}
          <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-6 py-8 lg:flex">
            <div className="flex flex-col items-center text-center">
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

            <div className="mt-7 grid grid-cols-2 gap-2">
              <DecisionButtons
                status={status}
                pending={pendingId === applicant.id}
                error={decisionError}
                onChange={changeStatus}
              />
            </div>

            <nav aria-label="Application sections" className="mt-auto flex flex-col gap-1 pt-8">
              <SideLink
                active={section === "home"}
                icon={<Home strokeWidth={2.5} size={15} />}
                label="Home"
                onClick={() => setSection("home")}
              />
              <SideLink
                active={section === "portfolio"}
                icon={<Globe strokeWidth={2.5} size={15} />}
                label="Portfolio"
                onClick={() => setSection("portfolio")}
              />
              <SideLink
                active={section === "linkedin"}
                icon={<Linkedin strokeWidth={2.5} size={15} />}
                label="LinkedIn"
                onClick={() => setSection("linkedin")}
              />
              {applicant.resume_url && (
                <SideLink
                  active={section === "resume"}
                  icon={<FileText strokeWidth={2.5} size={15} />}
                  label="Resume"
                  onClick={() => setSection("resume")}
                />
              )}
              <SideLink
                active={section === "profile"}
                icon={<UserRound strokeWidth={2.5} size={15} />}
                label="Profile"
                onClick={() => setSection("profile")}
              />
            </nav>
          </aside>

          {/* The page itself. */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* Below lg the sidebar is hidden, so the sections ride here as
                a horizontal strip; the active one keeps its label. */}
            <nav
              aria-label="Application sections"
              className="flex shrink-0 items-center justify-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 lg:hidden"
            >
              {sectionItems.map((item) => {
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
            </nav>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
              <div className="mx-auto w-full max-w-3xl px-6 pb-32 pt-12 sm:px-10">
                {section === "home" ? (
                  <HomeSection applicant={applicant} job={job} onSection={setSection} />
                ) : section === "portfolio" ? (
                  <LinkSection
                    title="Portfolio"
                    description={`The work ${firstName(applicant.name)} shared with this application.`}
                    icon={<Globe strokeWidth={2.25} size={20} />}
                    iconClass="bg-accent-soft text-foreground"
                    name={displayUrl(applicant.portfolio_url)}
                    url={applicant.portfolio_url}
                    openLabel="Open portfolio"
                  />
                ) : section === "linkedin" ? (
                  <LinkSection
                    title="LinkedIn"
                    description={`${firstName(applicant.name)}'s professional profile, as shared with this application.`}
                    icon={<Linkedin strokeWidth={2.25} size={20} />}
                    iconClass="bg-[#0A66C2]/10 text-[#0A66C2]"
                    name="LinkedIn profile"
                    url={applicant.linkedin_url}
                    openLabel="Open LinkedIn"
                  />
                ) : section === "resume" && applicant.resume_url ? (
                  <LinkSection
                    title="Resume"
                    description={`The document ${firstName(applicant.name)} attached to this application.`}
                    icon={<FileText strokeWidth={2.25} size={20} />}
                    iconClass="bg-accent-soft text-foreground"
                    name="Resume"
                    url={applicant.resume_url}
                    openLabel="Open resume"
                  />
                ) : (
                  <ProfileSection
                    applicant={applicant}
                    job={job}
                    onOpenProfile={openProfile}
                  />
                )}
              </div>
            </div>

            {/* Browse control — previous / next across the applicants this
                view was opened on. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
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
    </ModalPortal>
  );
}

/**
 * The home page of the applicant's page: the greeting, the headline the
 * profile supplies (bio, else the composed role and city, else the posting),
 * and a tile per filled-in item that opens its section.
 */
function HomeSection({
  applicant,
  job,
  onSection,
}: {
  applicant: JobApplicantDetail;
  job: JobPost;
  onSection: (section: DesignSection) => void;
}) {
  const headline =
    applicant.bio ??
    (applicant.role_label
      ? `${applicant.role_label}${applicant.city_name ? ` based in ${applicant.city_name}` : ""}`
      : `Applied for ${job.title}.`);

  const tiles: {
    key: DesignSection;
    label: string;
    value: string;
    icon: ReactNode;
    iconClass: string;
  }[] = [
    {
      key: "portfolio",
      label: "Portfolio",
      value: displayUrl(applicant.portfolio_url),
      icon: <Globe strokeWidth={2.25} size={19} />,
      iconClass: "bg-accent-soft text-foreground",
    },
    {
      key: "linkedin",
      label: "LinkedIn",
      value: displayUrl(applicant.linkedin_url),
      icon: <Linkedin strokeWidth={2.25} size={19} />,
      iconClass: "bg-[#0A66C2]/10 text-[#0A66C2]",
    },
    ...(applicant.resume_url
      ? [
          {
            key: "resume" as const,
            label: "Resume",
            value: "Attached to the application",
            icon: <FileText strokeWidth={2.25} size={19} />,
            iconClass: "bg-accent-soft text-foreground",
          },
        ]
      : []),
    {
      key: "profile",
      label: "Profile",
      value:
        [applicant.role_label, applicant.city_name].filter(Boolean).join(" · ") ||
        "Member on uxcommunity",
      icon: <UserRound strokeWidth={2.25} size={19} />,
      iconClass: "bg-accent-soft text-foreground",
    },
  ];

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-display text-4xl font-semibold tracking-[-0.02em] text-foreground sm:text-5xl">
        Hi, I&apos;m{" "}
        <span className="bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 bg-clip-text text-transparent">
          {firstName(applicant.name)}
        </span>
      </h1>
      <p className="mt-4 max-w-xl font-body text-base leading-relaxed text-foreground-muted">
        {headline}
      </p>

      <div className="mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => onSection(tile.key)}
            className="group flex cursor-pointer items-center gap-3.5 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent/20 hover:bg-surface-raised"
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tile.iconClass}`}
            >
              {tile.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-body text-sm font-semibold text-foreground">
                {tile.label}
              </span>
              <span className="mt-0.5 block truncate font-body text-xs text-foreground-muted">
                {tile.value}
              </span>
            </span>
            <ArrowRight
              strokeWidth={2.5}
              size={16}
              className="shrink-0 text-foreground-subtle transition-colors group-hover:text-foreground"
            />
          </button>
        ))}
      </div>

      <p className="mt-8 font-body text-xs text-foreground-subtle">
        Applied for {job.title} at {job.company.name} · {applicant.applied_label}
      </p>
    </div>
  );
}

/** A link section (portfolio, LinkedIn, resume) — the link, in full, with its door. */
function LinkSection({
  title,
  description,
  icon,
  iconClass,
  name,
  url,
  openLabel,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  iconClass: string;
  name: string;
  url: string;
  openLabel: string;
}) {
  return (
    <section className="mx-auto max-w-xl">
      <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      <p className="mt-1.5 font-body text-sm text-foreground-muted">{description}</p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClass}`}>
          {icon}
        </span>
        <p className="mt-4 font-display text-lg font-semibold text-foreground">{name}</p>
        <p className="mt-1 break-all font-body text-sm text-foreground-muted">{url}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          {openLabel}
          <ArrowUpRight strokeWidth={2.5} size={15} />
        </a>
        <p className="mt-3 font-body text-xs text-foreground-subtle">Opens in a new tab.</p>
      </div>
    </section>
  );
}

/** The member profile behind the application — who the poster would be hiring. */
function ProfileSection({
  applicant,
  job,
  onOpenProfile,
}: {
  applicant: JobApplicantDetail;
  job: JobPost;
  onOpenProfile: () => void;
}) {
  const meta = [applicant.city_name, applicant.member_since].filter(Boolean).join(" · ");

  return (
    <section className="mx-auto max-w-xl">
      <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        Profile
      </h2>
      <p className="mt-1.5 font-body text-sm text-foreground-muted">
        The member profile behind this application.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center gap-4">
          <AvatarImg
            url={applicant.avatar_url}
            name={applicant.name}
            size={64}
            className="rounded-full object-cover"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-foreground">
              {applicant.name}
            </p>
            {applicant.role_label && (
              <p className="mt-0.5 truncate font-body text-sm text-foreground-muted">
                {applicant.role_label}
              </p>
            )}
            {meta && <p className="mt-1 truncate font-body text-xs text-foreground-subtle">{meta}</p>}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-border pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="font-body text-xs font-medium text-foreground-subtle">Applied for</dt>
            <dd className="font-body text-sm text-foreground">
              {job.title} · {job.company.name}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-body text-xs font-medium text-foreground-subtle">Applied</dt>
            <dd className="font-body text-sm text-foreground">{applicant.applied_label}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onOpenProfile}
          className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          Open profile
          <ArrowRight strokeWidth={2.5} size={15} />
        </button>
      </div>
    </section>
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

function HeaderLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={`Open ${label}`}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-accent-soft hover:text-foreground"
    >
      {children}
    </a>
  );
}

/** The first word of a member's name, as the greeting uses it. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** A URL as a reader scans it — scheme and trailing slash stripped. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
}
