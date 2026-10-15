"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Plus, Search } from "lucide-react";
import { JobCard } from "./JobCard";
import { JobDetail } from "./JobDetail";
import { FeedLoadMore } from "@/components/feeds/FeedLoadMore";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobFeedRow, JobPost, JobViewer } from "@/lib/jobs/types";

/** The two browse tabs. They carry an unseen-roles badge instead of a total. */
type BrowseKind = "hiring" | "referral";
type Tab = BrowseKind | "applied" | "posts";

/**
 * "N new" — matched roles posted since the member last opened that browse
 * tab. There is no read tracking in the database, so the cut-off lives in the
 * browser, keyed per account, and is carried as the newest posting instant
 * that has been seen — a value taken from the data itself, never the browser
 * clock, so the two sides cannot disagree. A kind with none stored counts
 * everything as new, so a first visit shows what is waiting for the profile.
 */
const seenStorageKey = (viewerId: string) => `uxcommunity:jobs-seen:${viewerId}`;

function readTabSeen(viewerId: string): Partial<Record<BrowseKind, number>> {
  try {
    const raw = window.localStorage.getItem(seenStorageKey(viewerId));
    return raw ? (JSON.parse(raw) as Partial<Record<BrowseKind, number>>) : {};
  } catch {
    // Unreadable storage reads as "never visited": everything counts as new.
    return {};
  }
}

function markTabSeen(viewerId: string, kind: BrowseKind, newestPosted: number): void {
  // An empty list marks nothing — the old cut-off stays, so roles arriving
  // after an empty visit still count as new.
  if (!(newestPosted > 0)) return;
  try {
    const seen = readTabSeen(viewerId);
    // Only ever forward: two tabs racing, or a StrictMode replay, must not
    // move the cut-off backwards.
    if ((seen[kind] ?? 0) >= newestPosted) return;
    seen[kind] = newestPosted;
    window.localStorage.setItem(seenStorageKey(viewerId), JSON.stringify(seen));
  } catch {
    // Storage unavailable (private mode): the badge simply reappears next visit.
  }
}

/** The newest posting instant in a list, or 0 for an empty one. */
function newestInstant(list: JobFeedRow[]): number {
  return list.reduce((max, job) => Math.max(max, Date.parse(job.created_at)), 0);
}

/**
 * The jobs board, LinkedIn-style: the browse tabs split the open roles by
 * kind — "#Hiring" and "#Referral", the same two intents the cards' hashtag
 * tags name — and "Applied" joins them; on those three the rail
 * lists postings and the pane shows the selected one — selecting is local
 * state, not a route change. The rail and the pane are fed by one list of CARD
 * rows (`get_job_feed` returns the posting without its prose), so the pane
 * opens on the row it was given and fetches the posting's three prose fields
 * behind it: the read costs one small request per posting per session, and
 * nothing in the pane — title, company, poster, badges, Apply, the owner's
 * menu — waits for it. "My posts" is a plain list: each post opens
 * its own view page (`/dashboard/jobs/<id>`), not the master-detail pane.
 * Below lg the panes take turns instead of sitting side by side; `?job=` only
 * seeds the selection (and the tab its kind implies), so "back to this job"
 * links reopen it on arrival.
 *
 * The feed returns every posting to every member, but the browse tabs only
 * show roles the member could still apply to: their own posts live under "My
 * posts", roles they applied to move to "Applied", and roles their profile
 * misses on a gating criterion stay out entirely — `can_apply` is the same
 * predicate the write enforces, so no card in these lists is ever "Locked
 * for your profile".
 */
export function JobsBrowser({
  viewer,
  initialJobs,
  initialHasMore,
  master,
  initialJobId = null,
}: {
  viewer: JobViewer;
  /** Card rows: the first page of the feed, exactly as the rail renders it. */
  initialJobs: JobFeedRow[];
  /** Whether the RSC first page was capped — i.e. an older page exists. */
  initialHasMore: boolean;
  master: JobMasterData;
  initialJobId?: string | null;
}) {
  const router = useRouter();
  // The board holds only the pages loaded so far; older postings arrive page
  // by page under the rail (the tab counts grow with them).
  const [jobs, setJobs] = useState(initialJobs);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  // The postings read in full this session, by id. The rail's rows carry no
  // prose, so this is what the pane's prose sections read from — and it is
  // also the owner's own read: the edit form opens on an entry here rather
  // than on the card-shaped row. Kept for the session, so a member selecting
  // back and forth across the board pays for a posting's prose once.
  const [details, setDetails] = useState<Record<string, JobPost>>({});
  const detailsRef = useRef<Record<string, JobPost>>({});
  const detailRequests = useRef(new Map<string, Promise<JobPost | null>>());
  const seeded = (initialJobId && jobs.find((job) => job.id === initialJobId)) || null;
  const [tab, setTab] = useState<Tab>(
    seeded?.is_mine
      ? "posts"
      : seeded?.applied
        ? "applied"
        : seeded?.kind === "referral"
          ? "referral"
          : "hiring"
  );
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    seeded?.id ?? jobs.find((job) => !job.is_mine)?.id ?? null
  );
  // Below lg the panes take turns; from lg up both are always visible.
  const [paneOpen, setPaneOpen] = useState(Boolean(seeded && !seeded.is_mine));
  const paneRef = useRef<HTMLDivElement>(null);
  const scrolledId = useRef(selectedId);

  /**
   * Read one posting in full — once. The board's rows are card-shaped, so the
   * pane's prose (and the owner's edit form) come from here.
   *
   * Two caches, because two things are being prevented: `detailsRef` stops a
   * posting from ever being read twice, and `detailRequests` stops a
   * selection that changes twice in a moment — or the pane's own effect racing
   * the owner's menu — from putting two requests for the SAME posting in
   * flight. Both are refs: neither is render state, and neither may re-create
   * this callback, which the pane's effect depends on.
   */
  const loadDetail = useCallback(async (jobId: string): Promise<JobPost | null> => {
    const cached = detailsRef.current[jobId];
    if (cached) return cached;

    const inFlight = detailRequests.current.get(jobId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (!response.ok) return null;
        const body = (await response.json()) as { job?: JobPost };
        if (!body.job) return null;
        // Remembered BEFORE it is published: a second caller arriving between
        // the two reads the cache, not the network.
        detailsRef.current = { ...detailsRef.current, [jobId]: body.job };
        setDetails(detailsRef.current);
        return body.job;
      } catch {
        // Offline, or the route failed: the pane keeps the row it has, which
        // is everything but the prose, and the next selection can retry.
        return null;
      } finally {
        detailRequests.current.delete(jobId);
      }
    })();

    detailRequests.current.set(jobId, request);
    return request;
  }, []);

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
  // Other members' open roles, split by kind before the profile match
  // narrows them: applied roles leave the browse lists (their state lives
  // under "Applied"), and the lists themselves keep only the postings this
  // member could apply to — `can_apply` is the same predicate the write
  // enforces, so a "Locked for your profile" card never shows in them. The
  // pre-match lists stay for the empty state's explanation.
  const hiringPosts = jobs.filter((job) => !job.is_mine && !job.applied && job.kind === "hiring");
  const referralPosts = jobs.filter(
    (job) => !job.is_mine && !job.applied && job.kind === "referral"
  );
  const hiringJobs = hiringPosts.filter((job) => job.can_apply);
  const referralJobs = referralPosts.filter((job) => job.can_apply);
  const appliedJobs = jobs.filter((job) => !job.is_mine && job.applied);

  // The browse tabs' "N new", counted once on arrival from the stored
  // cut-off. The ref gate matters twice: it keeps the count from depending on
  // derived-array identities, and StrictMode's mount replay would otherwise
  // recompute AFTER the first run marked the tab seen — blanking the badge
  // the moment the page opened.
  const [tabNewCounts, setTabNewCounts] = useState<Record<BrowseKind, number> | null>(null);
  const countedRef = useRef(false);
  useEffect(() => {
    if (countedRef.current) return;
    countedRef.current = true;

    const seen = readTabSeen(viewer.id);
    setTabNewCounts({
      hiring: hiringJobs.filter((job) => Date.parse(job.created_at) > (seen.hiring ?? 0)).length,
      referral: referralJobs.filter((job) => Date.parse(job.created_at) > (seen.referral ?? 0))
        .length,
    });

    // The tab the board opens on is being looked at right now — remember
    // what was seen, so the next visit only counts roles posted after this.
    if (tab === "hiring" || tab === "referral") {
      markTabSeen(viewer.id, tab, newestInstant(tab === "hiring" ? hiringJobs : referralJobs));
    }
  }, [hiringJobs, referralJobs, tab, viewer.id]);

  // The active tab's browse list, or null on the non-browse tabs. The pane
  // derives its posting from that list (first one when nothing is picked), so
  // a stale selection — a role from another tab, or the viewer's own post
  // carried in by a back link — can never surface in the pane, and an empty
  // list shows no job at all. "My posts" shows no pane at all: it is a plain
  // list.
  const browseList =
    tab === "hiring" ? hiringJobs : tab === "referral" ? referralJobs : null;
  const paneJobs = browseList ?? (tab === "applied" ? appliedJobs : null);
  const selectedJob = paneJobs
    ? (paneJobs.find((job) => job.id === selectedId) ?? paneJobs[0] ?? null)
    : null;
  const highlightedId = paneJobs ? (selectedJob?.id ?? null) : selectedId;
  // The pane's posting: the full read when it has arrived, the rail's own row
  // until then. The row is what makes the wait invisible — every part of the
  // pane except the three prose sections renders from it immediately.
  const paneJob = selectedJob ? (details[selectedJob.id] ?? selectedJob) : null;
  const selectedJobId = selectedJob?.id ?? null;

  // Read the selected posting in full — including the board's opening
  // selection, so its prose is on its way from the first frame. Keyed on the
  // ID, not on `selectedJob`: that object is re-derived on every render, and an
  // effect that depended on it would re-run for reasons that have nothing to
  // do with which posting is open.
  useEffect(() => {
    if (!selectedJobId || details[selectedJobId]) return;
    void loadDetail(selectedJobId);
  }, [selectedJobId, details, loadDetail]);

  const query = search.trim().toLowerCase();
  const visibleJobs =
    browseList !== null
      ? browseList.filter(
          (job) =>
            !query ||
            job.title.toLowerCase().includes(query) ||
            job.company.name.toLowerCase().includes(query) ||
            job.skills.some((skill) => skill.toLowerCase().includes(query))
        )
      : tab === "applied"
        ? appliedJobs
        : myPosts;

  const newBadge = (count: number | undefined) => (count && count > 0 ? `${count} new` : null);
  const tabs: { value: Tab; label: string; chip: string | null; unseen: boolean }[] = [
    { value: "hiring", label: "# Hiring", chip: newBadge(tabNewCounts?.hiring), unseen: true },
    { value: "referral", label: "# Referral", chip: newBadge(tabNewCounts?.referral), unseen: true },
    { value: "applied", label: "Applied", chip: String(appliedJobs.length), unseen: false },
    { value: "posts", label: "My posts", chip: String(myPosts.length), unseen: false },
  ];

  const openTab = (next: Tab) => {
    setTab(next);
    if (next === "hiring" || next === "referral") {
      // Opening the tab is seeing it: the badge clears and the cut-off moves.
      setTabNewCounts((counts) => (counts ? { ...counts, [next]: 0 } : counts));
      markTabSeen(viewer.id, next, newestInstant(next === "hiring" ? hiringJobs : referralJobs));
    }
  };

  const selectJob = (jobId: string) => {
    if (tab === "posts") {
      // My posts have their own view page; the pane is for browsing.
      router.push(`/dashboard/jobs/${jobId}`);
      return;
    }
    setSelectedId(jobId);
    setPaneOpen(true);
  };

  /** Older postings — appended below the rail in the same newest-first order. */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || jobs.length === 0) return;
    const last = jobs[jobs.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/jobs/feed?before=${encodeURIComponent(`${last.created_at}|${last.id}`)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { jobs?: JobFeedRow[]; has_more?: boolean };
      const incoming = data.jobs ?? [];
      setJobs((prev) => {
        const ids = new Set(prev.map((job) => job.id));
        return [...prev, ...incoming.filter((job) => !ids.has(job.id))];
      });
      setHasMore(Boolean(data.has_more));
    } catch {
      // Network error — leave the board as it is.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, jobs, loadingMore]);

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

      {/* Tabs — the admin strip's style (accent underline, count chip); the
          browse tabs carry an "N new" badge instead of a total — matched
          roles posted since the member last opened them. */}
      <div
        className={`mt-5 ${paneOpen ? "hidden lg:flex" : "flex"} items-center gap-0.5 border-b border-border`}
      >
        {tabs.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => openTab(item.value)}
              className={`-mb-px border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {item.label}
              {item.chip !== null && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                    item.unseen || active
                      ? "bg-accent/15 text-accent"
                      : "bg-surface-raised text-foreground-muted"
                  }`}
                >
                  {item.chip}
                </span>
              )}
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
          {/* Search (browse tabs only) */}
          {browseList !== null && browseList.length > 0 && (
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
                // The owner's edit form needs the posting's prose, which a list
                // row does not carry — so the menu opens it on a detail read.
                loadFullJob={loadDetail}
                // The browse list holds other members' roles, so only "My
                // posts" ever carries the owner's controls.
                showOwnerActions={tab === "posts"}
                selected={job.id === highlightedId}
                onSelect={() => selectJob(job.id)}
              />
            ))}

            {visibleJobs.length === 0 &&
              (browseList !== null ? (
                query && browseList.length > 0 ? (
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
                ) : (tab === "hiring" ? hiringPosts : referralPosts).length > 0 ? (
                  <EmptyState
                    title={
                      tab === "hiring"
                        ? "No hiring roles match your profile yet"
                        : "No referral roles match your profile yet"
                    }
                    body="A role lands here when your profile matches it — job title and experience level always, and city and sector unless the poster set them to All. Keep your profile current, and check back as new roles arrive."
                  />
                ) : tab === "hiring" ? (
                  <EmptyState
                    title="No hiring posts from other members yet"
                    body="Your own posts live under My posts, and roles you apply to move to Applied — hiring posts from other members will show up here."
                  />
                ) : (
                  <EmptyState
                    title="No referral posts from other members yet"
                    body="Your own posts live under My posts, and roles you apply to move to Applied — referral posts from other members will show up here."
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

          <FeedLoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
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

            {paneJob && <JobDetail job={paneJob} viewer={viewer} />}
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
