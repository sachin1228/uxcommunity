import { Calendar } from "lucide-react";

export const metadata = { title: "Events — uxcommunity" };

export default function EventsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <Calendar strokeWidth={2.5} size={48} className="text-foreground-muted opacity-40" />
      <div>
        <h1 className="font-body text-xl font-semibold text-foreground">
          Events
        </h1>
        <p className="mt-1 font-body text-sm text-foreground-muted">
          Coming soon
        </p>
      </div>
    </div>
  );
}
