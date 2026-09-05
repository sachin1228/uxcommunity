import { Briefcase } from "lucide-react";

export const metadata = { title: "Jobs — uxcommunity" };

export default function JobsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <Briefcase strokeWidth={2.5} size={48} className="text-foreground-muted opacity-40" />
      <div>
        <h1 className="font-body text-xl font-semibold text-foreground">
          Jobs
        </h1>
        <p className="mt-1 font-body text-sm text-foreground-muted">
          Coming soon
        </p>
      </div>
    </div>
  );
}
