/**
 * Skeleton shown by Next.js while the server component for a community page
 * is resolving (primarily on hard refreshes). Matches the CommunityChat layout
 * exactly so there is no layout shift when real content arrives.
 */
export default function CommunityLoading() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-pulse">

      {/* Header — no bg-surface */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 h-[57px]">
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
            <div className="flex items-start gap-2 mt-3">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
                <div className="h-8 w-52 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <div className="h-8 w-40 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>
            <div className="flex items-start gap-2 mt-0.5">
              <div className="w-7 shrink-0" />
              <div className="h-8 w-64 rounded-2xl rounded-tl-sm bg-surface-raised" />
            </div>
            <div className="flex justify-end mt-3">
              <div className="h-12 w-48 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>
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

        {/* Info sidebar — w-80, two rounded cards, no bg */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">

          {/* Main info card */}
          <div className="border border-border mr-4 mt-4 rounded-xl flex flex-col">

            {/* Members section */}
            <div className="px-4 py-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="h-3 w-24 rounded bg-surface-raised" />
                <div className="h-3 w-10 rounded bg-surface-raised" />
              </div>
              <div className="flex items-center">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="h-7 w-7 rounded-full bg-surface-raised ring-2 ring-surface shrink-0"
                    style={{ marginLeft: i === 0 ? 0 : -10 }}
                  />
                ))}
              </div>
            </div>

            {/* About section */}
            <div className="px-4 py-4 border-b border-border">
              <div className="h-3 w-10 rounded bg-surface-raised mb-3" />
              <div className="space-y-2 mb-3">
                <div className="h-2.5 w-full rounded bg-surface-raised" />
                <div className="h-2.5 w-4/5 rounded bg-surface-raised" />
                <div className="h-2.5 w-2/3 rounded bg-surface-raised" />
              </div>
              <div className="space-y-2 mb-3">
                <div className="h-2.5 w-28 rounded bg-surface-raised" />
                <div className="h-2.5 w-36 rounded bg-surface-raised" />
              </div>
              <div className="flex gap-1.5">
                <div className="h-5 w-14 rounded-full bg-surface-raised" />
                <div className="h-5 w-16 rounded-full bg-surface-raised" />
                <div className="h-5 w-20 rounded-full bg-surface-raised" />
              </div>
            </div>

            {/* Upcoming Events section */}
            <div className="px-4 py-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="h-3 w-28 rounded bg-surface-raised" />
                <div className="h-3 w-10 rounded bg-surface-raised" />
              </div>
              <div className="flex gap-3">
                <div className="w-16 h-16 rounded-lg bg-surface-raised shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-2.5 w-4/5 rounded bg-surface-raised" />
                  <div className="h-2.5 w-3/5 rounded bg-surface-raised" />
                  <div className="h-2.5 w-2/5 rounded bg-surface-raised" />
                </div>
              </div>
              <div className="mt-3 h-8 w-full rounded-lg bg-surface-raised" />
            </div>

            {/* Popular Resources section — last, no border-b */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="h-3 w-28 rounded bg-surface-raised" />
                <div className="h-3 w-10 rounded bg-surface-raised" />
              </div>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-raised shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-2.5 w-3/4 rounded bg-surface-raised" />
                      <div className="h-2 w-1/2 rounded bg-surface-raised" />
                    </div>
                    <div className="h-4 w-4 rounded bg-surface-raised shrink-0" />
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end main info card */}

          {/* Community Stats card */}
          <div className="border border-border mr-4 mb-4 rounded-xl px-4 py-4">
            <div className="h-3 w-28 rounded bg-surface-raised mb-3" />
            <div className="grid grid-cols-3 gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-surface-raised rounded-xl px-3 py-3 flex flex-col gap-1.5 border border-border">
                  <div className="h-4 w-10 rounded bg-surface" />
                  <div className="h-2 w-12 rounded bg-surface" />
                </div>
              ))}
            </div>
          </div>

        </div>{/* end info sidebar */}

      </div>
    </div>
  );
}
