/**
 * Skeleton for the community page.
 *
 * Real layout (CommunityChat):
 *   flex-row
 *     flex-col (chat column, flex-1)
 *       ChatHeader   ← header is INSIDE the chat column, not full-width
 *       messages / tab content
 *     CommunityInfoPanel (w-72, full height, starts from top)
 */
export default function CommunityLoading() {
  return (
    <div className="flex-1 flex overflow-hidden animate-pulse">

      {/* ── Chat column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header — same padding as ChatHeader */}
        <div className="px-5 pt-4 border-b border-border shrink-0">

          {/* Row 1: avatar + name | buttons */}
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-surface-raised shrink-0" />
              <div className="space-y-1.5">
                <div className="h-3 w-36 rounded bg-surface-raised" />
                <div className="h-2.5 w-24 rounded bg-surface-raised" />
              </div>
            </div>
            {/* Bell + Joined + ··· */}
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-surface-raised" />
              <div className="h-8 w-20 rounded-lg bg-surface-raised" />
              <div className="h-8 w-8 rounded-lg bg-surface-raised" />
            </div>
          </div>

          {/* Row 2: tabs */}
          <div className="flex items-center gap-5">
            <div className="py-2.5 px-3"><div className="h-3 w-8 rounded bg-surface-raised" /></div>
            <div className="py-2.5 px-3"><div className="h-3 w-14 rounded bg-surface-raised" /></div>
            <div className="py-2.5 px-3"><div className="h-3 w-12 rounded bg-surface-raised" /></div>
            <div className="py-2.5 px-3"><div className="h-3 w-16 rounded bg-surface-raised" /></div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto px-5 py-4 flex flex-col justify-end gap-3 pb-24">

            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-24 rounded bg-surface-raised" />
                <div className="h-10 w-56 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-7 shrink-0" />
              <div className="h-10 w-72 rounded-2xl rounded-tl-sm bg-surface-raised" />
            </div>

            <div className="flex justify-end">
              <div className="h-10 w-44 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>

            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
                <div className="h-16 w-60 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>

            <div className="flex justify-end">
              <div className="h-10 w-56 rounded-2xl rounded-tr-sm bg-surface-raised" />
            </div>

            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-full bg-surface-raised shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <div className="h-2.5 w-28 rounded bg-surface-raised" />
                <div className="h-10 w-48 rounded-2xl rounded-tl-sm bg-surface-raised" />
              </div>
            </div>

          </div>

          {/* Input */}
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-2">
            <div className="min-h-[52px] rounded-2xl bg-surface-raised" />
          </div>
        </div>

      </div>{/* end chat column */}

      {/* ── Info sidebar — full height, starts from top ── */}
      <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">

        {/* Main info card */}
        <div className="border border-border mr-4 mt-4 rounded-xl flex flex-col">

          {/* Members */}
          <div className="px-4 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="h-3 w-24 rounded bg-surface-raised" />
              <div className="h-2.5 w-14 rounded bg-surface-raised" />
            </div>
            <div className="flex items-center">
              {[0,1,2,3,4].map((i) => (
                <div
                  key={i}
                  className="h-7 w-7 rounded-full bg-surface-raised ring-2 ring-surface shrink-0"
                  style={{ marginLeft: i === 0 ? 0 : -10 }}
                />
              ))}
            </div>
          </div>

          {/* About */}
          <div className="px-4 py-4 border-b border-border">
            <div className="h-3 w-10 rounded bg-surface-raised mb-3" />
            <div className="space-y-2 mb-3">
              <div className="h-2.5 w-full rounded bg-surface-raised" />
              <div className="h-2.5 w-4/5 rounded bg-surface-raised" />
              <div className="h-2.5 w-3/5 rounded bg-surface-raised" />
            </div>
            <div className="flex items-center gap-1.5 mb-3">
              <div className="h-3 w-3 rounded bg-surface-raised shrink-0" />
              <div className="h-2.5 w-28 rounded bg-surface-raised" />
            </div>
            <div className="flex gap-1.5">
              <div className="h-5 w-16 rounded-full bg-surface-raised" />
              <div className="h-5 w-24 rounded-full bg-surface-raised" />
            </div>
          </div>

          {/* Rules */}
          <div className="px-4 py-4">
            <div className="h-3 w-10 rounded bg-surface-raised mb-3" />
            <div className="flex flex-col gap-2.5">
              {[0,1,2].map((i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="h-4 w-4 rounded-full bg-surface-raised shrink-0" />
                  <div className={`h-2.5 rounded bg-surface-raised ${i === 0 ? "w-full" : i === 1 ? "w-4/5" : "w-3/5"}`} />
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Stats card */}
        <div className="border border-border mr-4 mb-4 rounded-xl px-4 py-4">
          <div className="h-3 w-28 rounded bg-surface-raised mb-3" />
          <div className="grid grid-cols-3 gap-2">
            {[0,1,2].map((i) => (
              <div key={i} className="bg-surface-raised rounded-xl px-3 py-3 flex flex-col gap-1.5 border border-border">
                <div className="h-4 w-8 rounded bg-surface" />
                <div className="h-2 w-10 rounded bg-surface" />
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
