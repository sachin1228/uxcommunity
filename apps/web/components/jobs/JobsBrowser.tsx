"use client";

import { useState } from "react";
import { Briefcase, Plus, Search } from "lucide-react";
import { JobCard } from "./JobCard";
import { PostJobModal } from "./PostJobModal";
import { useGuardedRouter } from "@/lib/navigation-guard";
import type { JobMasterData } from "@/lib/jobs/service";
import type { JobPost, JobViewer } from "@/lib/jobs/types";

type Tab = "all" | "posts";

/**
 * The jobs board. Every posting is visible to every member — the profile
 * match is what unlocks Apply, not what hides the job — but the member's OWN
 * posts stay out of the browse list: they live under "My posts", so the board
 * only shows roles they could actually apply to.
 */
export function JobsBrowser({
  viewer,
  jobs,
  master,
}: {
  viewer: JobViewer;
  jobs: JobPost[];
  master: JobMasterData;
}) {
  const router = useGuardedRouter();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [postOpen, setPostOpen] = useState(false);

  const myPosts = jobs.filter((job) => job.is_mine);
  const otherJobs = jobs.filter((job) => !job.is_mine);

  const query = search.trim().toLowerCase();
  const visibleJobs =
    tab === "all"
      ? otherJobs.filter(
          (job) =>
            !query ||
            job.title.toLowerCase().includes(query) ||
            job.company.name.toLowerCase().includes(query) ||
            job.skills.some((skill) => skill.toLowerCase().includes(query))
        )
      : myPosts;

  const tabs: { value: Tab; label: string; count: number }[] = [
    { value: "all", label: "All jobs", count: otherJobs.length },
    { value: "posts", label: "My posts", count: myPosts.length },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
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
          onClick={() => setPostOpen(true)}
          className="modal-btn modal-btn-primary shrink-0"
        >
          <Plus strokeWidth={2.5} size={14} />
          Post a job
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex items-center gap-1 border-b border-border">
        {tabs.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={`relative -mb-px border-b-2 px-3 py-2 font-body text-sm font-medium transition-colors ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="ml-1.5 text-xs text-foreground-subtle">{item.count}</span>
            </button>
          );
        })}
      </div>

      {/* Search (All jobs only) */}
      {tab === "all" && otherJobs.length > 0 && (
        <div className="relative mt-4">
          <Search
            strokeWidth={2.5}
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search roles or companies…"
            className="field w-full pl-8"
          />
        </div>
      )}

      {/* Lists */}
      <div className="mt-4 flex flex-col gap-2.5">
        {visibleJobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}

        {visibleJobs.length === 0 &&
          (tab === "all" ? (
            query ? (
              <EmptyState
                title="No jobs match"
                body="Try a different search term."
              />
            ) : jobs.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                body="Be the first to post a role — you'll verify your company with a work email."
                action={
                  <button
                    type="button"
                    onClick={() => setPostOpen(true)}
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
                body="Your own posts live under My posts — roles posted by other members will show up here."
              />
            )
          ) : (
            <EmptyState
              title="You haven't posted a job yet"
              body="Post a role to start receiving applications from members whose profile matches."
              action={
                <button
                  type="button"
                  onClick={() => setPostOpen(true)}
                  className="modal-btn modal-btn-primary mt-3"
                >
                  <Plus strokeWidth={2.5} size={14} />
                  Post a job
                </button>
              }
            />
          ))}
      </div>

      {postOpen && (
        <PostJobModal
          open
          onClose={() => setPostOpen(false)}
          viewer={viewer}
          master={master}
          onCreated={(jobId) => {
            setPostOpen(false);
            router.push(`/dashboard/jobs/${jobId}`);
          }}
        />
      )}
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
