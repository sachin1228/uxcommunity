/**
 * Skeleton shown while the thread detail server component resolves.
 * Mirrors the ThreadDetailClient layout exactly.
 */
export default function ThreadDetailLoading() {
  return (
    <div className="flex-1 overflow-y-auto animate-pulse">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">

        {/* Back nav */}
        <div className="mb-5 h-3 w-40 rounded bg-surface-raised" />

        {/* Thread card */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-stretch">

            {/* Upvote column */}
            <div className="flex w-12 shrink-0 flex-col items-center gap-1 px-1 py-4">
              <div className="h-8 w-8 rounded-lg bg-surface-raised" />
              <div className="h-4 w-5 rounded bg-surface-raised" />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 py-4 pr-4">
              {/* Category + menu row */}
              <div className="flex items-center justify-between">
                <div className="h-5 w-24 rounded-full bg-surface-raised" />
                <div className="h-6 w-6 rounded-md bg-surface-raised" />
              </div>

              {/* Title */}
              <div className="mt-3 h-5 w-3/4 rounded bg-surface-raised" />
              <div className="mt-2 h-5 w-1/2 rounded bg-surface-raised" />

              {/* Description */}
              <div className="mt-5 space-y-2">
                <div className="h-3 w-full rounded bg-surface-raised" />
                <div className="h-3 w-full rounded bg-surface-raised" />
                <div className="h-3 w-4/5 rounded bg-surface-raised" />
              </div>

              {/* Tags */}
              <div className="mt-4 flex gap-2">
                <div className="h-3 w-12 rounded bg-surface-raised" />
                <div className="h-3 w-16 rounded bg-surface-raised" />
              </div>

              {/* Author row */}
              <div className="mt-4 flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-surface-raised" />
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
                <div className="h-2.5 w-16 rounded bg-surface-raised" />
                <div className="h-2.5 w-16 rounded bg-surface-raised" />
              </div>
            </div>
          </div>
        </div>

        {/* Comments section */}
        <div className="mt-6">
          {/* Section header */}
          <div className="mb-4 flex items-center gap-2">
            <div className="h-3.5 w-24 rounded bg-surface-raised" />
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Comment input box */}
          <div className="h-24 rounded-lg bg-surface-raised" />
          <div className="mt-2 flex justify-end">
            <div className="h-8 w-16 rounded-lg bg-surface-raised" />
          </div>

          {/* Comment rows */}
          <div className="mt-6 space-y-5">
            {[1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <div className="h-8 w-8 shrink-0 rounded-full bg-surface-raised" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-20 rounded bg-surface-raised" />
                    <div className="h-2.5 w-12 rounded bg-surface-raised" />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <div className="h-3 w-full rounded bg-surface-raised" />
                    <div className="h-3 w-3/4 rounded bg-surface-raised" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
