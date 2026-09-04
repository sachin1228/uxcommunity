import { Library } from "lucide-react";

export const metadata = { title: "Library — uxcommunity" };

export default function LibraryPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <Library strokeWidth={2.5} size={48} className="text-foreground-muted opacity-40" />
      <div>
        <h1 className="font-body text-xl font-semibold text-foreground">
          Library
        </h1>
        <p className="mt-1 font-body text-sm text-foreground-muted">
          Coming soon
        </p>
      </div>
    </div>
  );
}
