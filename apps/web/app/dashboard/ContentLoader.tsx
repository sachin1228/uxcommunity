import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";

/** Single-column shell shared by the homepage and every public card detail route. */
export function DashboardSingleColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-full w-full max-w-[40rem]">{children}</div>;
}

/** Loading shell for dashboard pages without a secondary rail. */
export function DashboardContentLoader({ header }: { header?: ReactNode }) {
  return (
    <DashboardSingleColumn>
      {header}
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    </DashboardSingleColumn>
  );
}
