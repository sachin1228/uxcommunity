import type { ReactNode } from "react";

interface ModalErrorProps {
  children: ReactNode;
  /**
   * Placement classes for the outer wrapper. Modals with a scrollable body
   * pin the banner above the footer with `shrink-0 px-5 pb-1 sm:px-6`;
   * compact dialogs keep it in flow with a margin (e.g. `mb-4`).
   */
  className?: string;
}

/**
 * The one error style inside modals: a floating red banner card. Renders
 * nothing when there is no message.
 */
export function ModalError({ children, className }: ModalErrorProps) {
  if (!children) return null;
  return (
    <div className={className}>
      <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
        <p className="font-body text-sm text-red-400">{children}</p>
      </div>
    </div>
  );
}
