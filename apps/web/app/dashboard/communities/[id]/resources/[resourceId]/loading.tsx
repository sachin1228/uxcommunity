export default function ResourceDetailLoading() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 animate-pulse">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <div className="h-6 w-24 rounded-full bg-surface-raised" />
            <div className="flex gap-2">
              <div className="h-8 w-20 rounded-lg bg-surface-raised" />
              <div className="h-8 w-16 rounded-lg bg-surface-raised" />
            </div>
          </div>
          <div className="mt-3 h-6 w-2/3 rounded bg-surface-raised" />
          <div className="mt-2 h-5 w-40 rounded-lg bg-surface-raised" />
          <div className="mt-4 space-y-2">
            <div className="h-3.5 w-full rounded bg-surface-raised" />
            <div className="h-3.5 w-5/6 rounded bg-surface-raised" />
            <div className="h-3.5 w-4/5 rounded bg-surface-raised" />
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
            <div className="h-6 w-6 rounded-full bg-surface-raised" />
            <div className="h-3 w-20 rounded bg-surface-raised" />
            <div className="h-3 w-16 rounded bg-surface-raised" />
          </div>
        </div>
      </div>
    </div>
  );
}
