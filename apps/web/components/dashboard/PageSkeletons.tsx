import type { ReactNode } from "react";
import { communityFeedLayout } from "@/components/communities/feed-layout";

function Block({ className, tone = "bg-surface-raised" }: { className: string; tone?: string }) {
  return <div className={`${tone} ${className.includes("rounded") ? "" : "rounded-md"} ${className}`} />;
}

function LoadingContent({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">{children}</div>
    </div>
  );
}

function Pills({ count = 4 }: { count?: number }) {
  return <div className="flex gap-2 overflow-hidden">{Array.from({ length: count }, (_, i) => <Block key={i} className="h-8 w-24 shrink-0 rounded-full" />)}</div>;
}

function PostCard() {
  return (
    <div className="space-y-5 rounded-xl border border-border bg-background-subtle p-5 md:p-6">
      <div className="flex items-center gap-3">
        <Block className="h-9 w-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Block className="h-3 w-28" /><Block className="h-2 w-20" /></div>
      </div>
      <Block className="h-4 w-3/4" />
      <div className="space-y-2"><Block className="h-3 w-full" /><Block className="h-3 w-5/6" /></div>
      <Block className="h-36 w-full" />
      <div className="flex gap-3"><Block className="h-4 w-12" /><Block className="h-4 w-12" /></div>
    </div>
  );
}

export function SavedCardsSkeleton() {
  return <LoadingContent label="Loading saved posts"><div className={communityFeedLayout.cardList}>{[0, 1, 2].map(i => <PostCard key={i} />)}</div></LoadingContent>;
}

export function SavedPageSkeleton() {
  return (
    <div className={`${communityFeedLayout.content} px-4 pb-12`}>
      <div className={communityFeedLayout.pageHeader}>
        <h1 className="font-display text-xl font-semibold text-foreground">Saved</h1>
        <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">Threads, showcase posts, resources and events you save appear here.</p>
      </div>
      <SavedCardsSkeleton />
    </div>
  );
}

function ExploreCard() {
  // The real card sits on bg-surface-raised, so its placeholder bars take the
  // page tone instead — the same inversion the other direction uses elsewhere.
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-2.5">
        <Block className="h-9 w-9 shrink-0 rounded-full" tone="bg-background-subtle" />
        <div className="min-w-0 flex-1 space-y-2">
          <Block className="h-3 w-3/4" tone="bg-background-subtle" />
          <Block className="h-2 w-1/2" tone="bg-background-subtle" />
        </div>
        <Block className="h-6 w-12 shrink-0 rounded-full" tone="bg-background-subtle" />
      </div>
      <div className="space-y-2 pl-[46px]">
        <Block className="h-2 w-full" tone="bg-background-subtle" />
        <Block className="h-2 w-3/4" tone="bg-background-subtle" />
      </div>
    </div>
  );
}

export function ExploreCardsSkeleton() {
  return (
    <LoadingContent label="Loading communities">
      {/* The page lists two sections ("Recommended for you", then the rest) —
          same spacing, same grid. */}
      <div className="space-y-6">
        <section>
          <Block className="mb-3 h-5 w-44" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <ExploreCard key={i} />)}</div>
        </section>
        <section>
          <Block className="mb-3 h-5 w-36" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map(i => <ExploreCard key={i} />)}</div>
        </section>
      </div>
    </LoadingContent>
  );
}

export function ExplorePageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pb-4 pt-6">
        <h1 className="mb-4 font-display text-xl font-semibold text-foreground">Explore Communities</h1>
        <div aria-hidden="true" className="space-y-4 pb-1 motion-safe:animate-pulse">
          {/* Search field: the real one is a 32px `.field` with a 13px
              magnifier — not a 40px block. */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
              width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <Block className="h-8 w-full" />
          </div>
          {/* Tab pills: All / Public / Private / Requests sent widths. */}
          <div className="flex flex-wrap items-center gap-2">
            <Block className="h-8 w-14 shrink-0 rounded-full" />
            <Block className="h-8 w-20 shrink-0 rounded-full" />
            <Block className="h-8 w-20 shrink-0 rounded-full" />
            <Block className="h-8 w-28 shrink-0 rounded-full" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-6 pb-6"><ExploreCardsSkeleton /></div>
    </div>
  );
}

export function LibraryPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[80rem] px-4 pb-12 md:px-6">
      <div className={communityFeedLayout.pageHeaderWithFilters}>
        <h1 className="font-display text-xl font-semibold text-foreground">Library</h1>
        <p className="mt-1 max-w-2xl text-pretty font-body text-sm leading-5 text-foreground-muted">Handpicked questions, discussions, polls, showcase work and resources curated from public posts across the community.</p>
        <div aria-hidden="true" className="motion-safe:animate-pulse">
          <div className="mt-5 border-b border-border pb-2"><Pills /></div>
          <div className={`${communityFeedLayout.pageHeaderFilters} pb-1`}><Pills count={6} /></div>
        </div>
      </div>
      <LoadingContent label="Loading library">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <PostCard key={i} />)}</div>
      </LoadingContent>
    </div>
  );
}

export function JobsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 lg:px-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold text-foreground">Jobs</h1>
        <div aria-hidden="true"><Block className="h-9 w-24" /></div>
      </div>
      <LoadingContent label="Loading jobs">
        <Block className="mt-2 h-4 w-64 max-w-full" />
        <div className="mt-5 border-b border-border pb-2"><Pills count={3} /></div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-2.5 pb-6 pt-4">
            <Block className="mb-4 h-9 w-full" />
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="space-y-4 rounded-xl border border-border bg-background-subtle p-4">
                <div className="flex items-center gap-3"><Block className="h-10 w-10 shrink-0" /><div className="flex-1 space-y-2"><Block className="h-4 w-3/4" /><Block className="h-3 w-1/2" /></div></div>
                <div className="flex gap-2"><Block className="h-5 w-20" /><Block className="h-5 w-24" /></div>
              </div>
            ))}
          </div>
          <div className="hidden min-w-0 space-y-6 border-l border-border pb-6 pl-5 pt-4 lg:block">
            <Block className="h-14 w-14" /><Block className="h-6 w-3/4" /><Block className="h-4 w-1/2" /><Block className="h-10 w-full" />
            {[0, 1, 2].map(i => <div key={i} className="space-y-3"><Block className="h-4 w-28" /><Block className="h-3 w-full" /><Block className="h-3 w-5/6" /><Block className="h-3 w-3/4" /></div>)}
          </div>
        </div>
      </LoadingContent>
    </div>
  );
}
