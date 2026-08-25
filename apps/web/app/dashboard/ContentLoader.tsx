import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Loading shell for centered dashboard detail pages.
 * Pass `header` to preserve optional page-specific header content.
 */
export function DashboardContentLoader({ header }: { header?: ReactNode }) {
  return (
    <div className="mx-auto min-h-full w-full max-w-3xl">
      {header}
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    </div>
  );
}
