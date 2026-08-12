export default function ResourceDetailLoading() {
  return (
    <div className="flex-1 overflow-y-auto animate-pulse">
      <div className="mx-auto w-full max-w-4xl py-6">
        <div className="relative border-y border-border px-5 py-6 md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="h-6 w-20 rounded-full bg-surface-raised" />
            <div className="flex gap-2">
              <div className="h-8 w-20 rounded-lg bg-surface-raised" />
              <div className="h-8 w-16 rounded-lg bg-surface-raised" />
            </div>
          </div>
          <div className="mt-4 h-6 w-2/3 rounded bg-surface-raised" />
          <div className="mt-3 h-7 w-28 rounded-lg bg-surface-raised" />
          <div className="mt-5 flex flex-col gap-2">
            <div className="h-3 w-full rounded bg-surface-raised" />
            <div className="h-3 w-5/6 rounded bg-surface-raised" />
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
            <div className="size-7 rounded-full bg-surface-raised" />
            <div className="h-3 w-24 rounded bg-surface-raised" />
            <div className="h-3 w-16 rounded bg-surface-raised" />
          </div>
        </div>

        <div className="px-5 pt-6 md:px-8">
          <div className="flex items-center gap-2">
            <div className="h-4 w-24 rounded bg-surface-raised" />
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4 h-24 rounded-lg bg-surface-raised" />
          <div className="mt-6 flex flex-col gap-5">
            {[1, 2].map((item) => (
              <div key={item} className="flex gap-3">
                <div className="size-8 shrink-0 rounded-full bg-surface-raised" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="h-3 w-24 rounded bg-surface-raised" />
                  <div className="h-3 w-3/4 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
