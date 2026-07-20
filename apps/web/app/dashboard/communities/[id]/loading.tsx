/**
 * Skeleton shown by Next.js while the server component for a community page
 * is resolving (primarily on hard refreshes). Matches the CommunityChat layout
 * exactly so there is no layout shift when real content arrives.
 */
export default function CommunityLoading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface shrink-0 h-[57px]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-surface-raised shrink-0" />
          <div className="space-y-1.5">
            <div className="h-3 w-32 rounded bg-surface-raised" />
            <div className="h-2.5 w-20 rounded bg-surface-raised" />
          </div>
        </div>
        <div className="h-4 w-16 rounded bg-surface-raised" />
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Incoming message */}
            <div className="flex items-start gap-2 mt-3">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
                <div className="h-8 w-52 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>
            {/* Outgoing message */}
            <div className="flex justify-end mt-3">
              <div className="h-8 w-40 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>
            {/* Incoming */}
            <div className="flex items-start gap-2 mt-0.5">
              <div className="w-7 shrink-0" />
              <div className="h-8 w-64 rounded-2xl rounded-tl-sm bg-surface-raised" />
            </div>
            {/* Outgoing */}
            <div className="flex justify-end mt-3">
              <div className="h-12 w-48 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>
            {/* Incoming */}
            <div className="flex items-start gap-2 mt-3">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-16 rounded bg-surface-raised" />
                <div className="h-8 w-44 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>
          </div>

          {/* Input */}
          <div className="px-4 pb-4 pt-2 shrink-0">
            <div className="h-[52px] rounded-2xl bg-surface-raised" />
          </div>
        </div>

        {/* Members panel */}
        <div className="w-56 shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="h-3.5 w-16 rounded bg-surface-raised" />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0" />
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
