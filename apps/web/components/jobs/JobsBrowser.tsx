"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Plus, Search } from "lucide-react";
import { JobCard } from "./JobCard";
import { JobDetail } from "./JobDetail";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost, JobViewer } from "@/lib/jobs/types";

type Tab = "all" | "applied" | "posts";

/**
 * The jobs board, LinkedIn-style: on "For you" and "Applied" the
 * rail lists postings and the pane shows the selected one — selecting is
 * local state, not a route change, because `get_job_feed` already returns the
 * full detail payload for every row. "My posts" is a plain list: each post
 * opens its own view page (`/dashboard/jobs/<id>`), not the master-detail
 * pane. Below lg the panes take turns instead of sitting side by side;
 * `?job=` only seeds the selection, so "back to this job" links reopen it on
 * arrival.
 *
 * Every posting is visible to every member — the profile match is what
 * unlocks Apply, not what hides the job — but the browse list only shows
 * roles the member could still apply to: their own posts live under "My
 * posts", and roles they applied to move to "Applied".
 */
export function JobsBrowser({
  viewer,
  jobs,
  master,
  initialJobId = null,
}: {
  viewer: JobViewer;
  jobs: JobPost[];
  master: JobMasterData;
  initialJobId?: string | null;
}) {
  const router = useRouter();
  const seeded = (initialJobId && jobs.find((job) => job.id === initialJobId)) || null;
  const [tab, setTab] = useState<Tab>(
    seeded?.is_mine ? "posts" : seeded?.applied ? "applied" : "all"
  );
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    seeded?.id ?? jobs.find((job) => !job.is_mine)?.id ?? null
  );
  // Below lg the panes take turns; from lg up both are always visible.
  const [paneOpen, setPaneOpen] = useState(Boolean(seeded && !seeded.is_mine));
  const paneRef = useRef<HTMLDivElement>(null);
  const scrolledId = useRef(selectedId);

  // A click deep in a long posting can leave the page scrolled past the top
  // of the pane that just swapped contents — bring the new job back into
  // view. Gated on the selection actually CHANGING: gating on mount alone is
  // not enough because StrictMode replays mount effects, and the replay scrolled
  // the pane's top edge flush with the scrollport — hiding the heading and
  // tabs the moment the page opened.
  useEffect(() => {
    if (scrolledId.current === selectedId) return;
    scrolledId.current = selectedId;
    paneRef.current?.scrollIntoView({ block: "start" });
  }, [selectedId]);

  const myPosts = jobs.filter((job) => job.is_mine);
  // Applied roles leave the browse list: their state (submitted, portfolio
  // links) lives under "Applied" instead of among the roles still
  // open to apply to.
  const browseJobs = jobs.filter((job) => !job.is_mine && !job.applied);
  const appliedJobs = jobs.filter((job) => !job.is_mine && job.applied);

  // The two browse tabs share the pane; "My posts" is a plain list. The shown
  // posting derives from the active tab's own list (first one when nothing is
  // picked), so a stale selection — a role from another tab, or the viewer's
  // own post carried in by a back link — can never surface in the pane, and
  // an empty list shows no job at all.
  const paneJobs = tab === "all" ? browseJobs : tab === "applied" ? appliedJobs : null;
  const selectedJob = paneJobs
    ? (paneJobs.find((job) => job.id === selectedId) ?? paneJobs[0] ?? null)
    : null;
  const highlightedId = paneJobs ? (selectedJob?.id ?? null) : selectedId;

  const query = search.trim().toLowerCase();
  const visibleJobs =
    tab === "all"
      ? browseJobs.filter(
          (job) =>
            !query ||
            job.title.toLowerCase().includes(query) ||
            job.company.name.toLowerCase().includes(query) ||
            job.skills.some((skill) => skill.toLowerCase().includes(query))
        )
      : tab === "applied"
        ? appliedJobs
        : myPosts;

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all", label: "For you", count: browseJobs.length },
    { value: "applied", label: "Applied", count: appliedJobs.length },
    { value: "posts", label: "My posts", count: myPosts.length },
  ];

  const selectJob = (jobId: string) => {
    if (tab === "posts") {
      // My posts have their own view page; the pane is for browsing.
      router.push(`/dashboard/jobs/${jobId}`);
      return;
    }
    setSelectedId(jobId);
    setPaneOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 lg:px-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Jobs</h1>
          <p className="mt-1 font-body text-sm text-foreground-muted">
            Roles posted by verified company members — apply to the ones that match your profile.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/jobs/new")}
          className="modal-btn modal-btn-primary shrink-0"
        >
          <Plus strokeWidth={2.5} size={14} />
          Post a job
        </button>
      </div>

      {/* Tabs — the admin strip's style (count chip, accent underline); the
          active tab's border rides on the full-width underline. */}
      <div
        className={`mt-5 ${paneOpen ? "hidden lg:flex" : "flex"} items-center gap-0.5 border-b border-border`}
      >
        {tabs.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={`-mb-px border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {item.label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  active ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
                }`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`grid grid-cols-1 gap-5${
          paneJobs && paneJobs.length > 0
            ? " lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start"
            : ""
        }`}
      >
        {/* Rail — the browse list; on My posts a centered column instead */}
        <div
          className={
            tab === "posts"
              ? "mx-auto flex w-full max-w-3xl flex-col px-4 py-6 lg:px-6"
              : `${paneOpen ? "hidden lg:flex" : "flex"} min-w-0 flex-col pt-4 pb-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh_-_6rem)] lg:self-start lg:overflow-y-auto`
          }
        >
          {/* Search (For you only) */}
          {tab === "all" && browseJobs.length > 0 && (
            <div className="relative mb-4">
              <Search
                strokeWidth={2.5}
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
              />
              {/* Real border, not the `field` ring: the rail is a scroll
                  container and clips the ring's outside-shadow at its edge,
                  which read as a cut border and corners. */}
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search roles or companies…"
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-subtle hover:border-foreground-subtle focus:border-foreground-muted"
              />
            </div>
          )}

          {/* Lists */}
          <div className="flex flex-col gap-2.5">
            {visibleJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                master={master}
                // The browse list holds other members' roles, so only "My
                // posts" ever carries the owner's controls.
                showOwnerActions={tab === "posts"}
                selected={job.id === highlightedId}
                onSelect={() => selectJob(job.id)}
              />
            ))}

            {visibleJobs.length === 0 &&
              (tab === "all" ? (
                query ? (
                  <EmptyState title="No jobs match" body="Try a different search term." />
                ) : jobs.length === 0 ? (
                  <EmptyState
                    title="No jobs yet"
                    body="Be the first to post a role — you'll verify your company with a work email."
                    action={
                      <button
                        type="button"
                        onClick={() => router.push("/dashboard/jobs/new")}
                        className="modal-btn modal-btn-primary mt-3"
                      >
                        <Plus strokeWidth={2.5} size={14} />
                        Post a job
                      </button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No jobs from other members yet"
                    body="Your own posts live under My posts, and roles you apply to move to Applied — roles posted by other members will show up here."
                  />
                )
              ) : tab === "applied" ? (
                <EmptyState
                  title="No applications yet"
                  body="Roles you apply to move here with their submission details, so you can follow them up in one place."
                />
              ) : (
                <EmptyState
                  title="You haven't posted a job yet"
                  body="Post a role to start receiving applications from members whose profile matches."
                  action={
                    <button
                      type="button"
                      onClick={() => router.push("/dashboard/jobs/new")}
                      className="modal-btn modal-btn-primary mt-3"
                    >
                      <Plus strokeWidth={2.5} size={14} />
                      Post a job
                    </button>
                  }
                />
              ))}
          </div>
        </div>

        {/* Pane — the selected posting, other members' roles only */}
        {paneJobs && paneJobs.length > 0 && (
          <div
            ref={paneRef}
            className={`${paneOpen ? "flex" : "hidden"} min-w-0 flex-col pt-4 pb-6 lg:flex lg:border-l lg:border-border lg:pl-5`}
          >
            <button
              type="button"
              onClick={() => setPaneOpen(false)}
              className="mb-3 inline-flex w-fit items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground lg:hidden"
            >
              <ArrowLeft strokeWidth={2.5} size={14} />
              Jobs
            </button>

            {selectedJob && <JobDetail job={selectedJob} viewer={viewer} />}
          </div>
        )}
      </div>

    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <Briefcase strokeWidth={2.5} size={28} className="text-foreground-muted opacity-40" />
      <p className="mt-3 font-display text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs font-body text-xs text-foreground-muted">{body}</p>
      {action}
    </div>
  );
}
