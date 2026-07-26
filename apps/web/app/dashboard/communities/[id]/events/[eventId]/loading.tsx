export default function EventDetailLoading() {
  return (
    <div className="flex-1 overflow-y-auto animate-pulse">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        {/* Back nav */}
        <div className="mb-5 h-3 w-36 rounded bg-surface-raised" />

        {/* Event card */}
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {/* Date banner */}
          <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-5 py-3">
            <div className="h-4 w-4 rounded bg-surface" />
            <div className="h-3 w-40 rounded bg-surface" />
            <div className="h-3 w-28 rounded bg-surface" />
          </div>

          <div className="px-5 py-5">
            {/* Title */}
            <div className="h-7 w-3/4 rounded bg-surface-raised" />
            <div className="mt-2 h-7 w-1/2 rounded bg-surface-raised" />

            {/* Description */}
            <div className="mt-5 space-y-2">
              <div className="h-3 w-full rounded bg-surface-raised" />
              <div className="h-3 w-full rounded bg-surface-raised" />
              <div className="h-3 w-2/3 rounded bg-surface-raised" />
            </div>

            {/* Detail rows */}
            <div className="mt-5 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-surface-raised" />
                  <div className="space-y-1.5">
                    <div className="h-2.5 w-20 rounded bg-surface-raised" />
                    <div className="h-2.5 w-32 rounded bg-surface-raised" />
                  </div>
                </div>
              ))}
            </div>

            {/* RSVP button */}
            <div className="mt-6 h-12 rounded-xl bg-surface-raised" />
          </div>
        </div>

        {/* Attendees */}
        <div className="mt-6">
          <div className="mb-3 h-2.5 w-20 rounded bg-surface-raised" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="h-6 w-6 rounded-full bg-surface-raised" />
                <div className="h-2.5 w-20 rounded bg-surface-raised" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
