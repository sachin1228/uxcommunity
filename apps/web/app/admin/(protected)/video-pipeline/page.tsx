import { VideoPipelineHealthCard } from "@/components/admin/VideoPipelineHealthCard";

export const metadata = { title: "Video Pipeline · Admin" };

export default function VideoPipelinePage() {
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold text-foreground mb-1">
          Video Pipeline
        </h1>
        <p className="font-body text-xs text-foreground-muted">
          Health of the server-side video transcoder: engine availability,
          queue depth, and job stats. Processing settings live in{" "}
          <code className="rounded bg-surface-raised px-1 py-0.5 text-[10px]">
            packages/shared/src/video/video-config.ts
          </code>
          ; the full architecture is documented in docs/video-processing.md.
        </p>
      </div>

      <VideoPipelineHealthCard />
    </div>
  );
}