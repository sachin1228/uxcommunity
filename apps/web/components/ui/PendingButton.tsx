"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";

interface PendingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** True while the action is in flight. The button also disables itself. */
  pending: boolean;
  /**
   * Announced to screen readers while pending: the visible label is hidden
   * then, so without this the button would have no accessible name. Safe to
   * omit on icon-only buttons that already carry an `aria-label`.
   */
  pendingLabel?: string;
  /** Spinner diameter in px. Defaults to 15, the modal-footer size. */
  spinnerSize?: number;
  children: ReactNode;
}

/**
 * A button that shows a spinner while its action is pending.
 *
 * Two rules are baked in here so every save/submit/post/join button behaves the
 * same, and both exist because the naive version of this got them wrong:
 *
 * 1. The label never leaves the layout. It is only made invisible, so the
 *    button keeps the exact height and width it had before the click and
 *    nothing around it shifts while the request runs.
 * 2. The spinner is centered by an absolutely positioned overlay and paints in
 *    the button's own text color. Hard-coding a color (`text-white`) is how the
 *    primary buttons ended up with a white spinner on their white accent
 *    background in the dark theme — an apparently empty button mid-save.
 *
 * The resting content sits in a `contents` box, so it keeps taking part in the
 * button's own flex layout (its gap, its alignment). Adopting this component
 * does not move the label by a pixel.
 */
export function PendingButton({
  pending,
  pendingLabel,
  spinnerSize = 15,
  className = "",
  disabled,
  children,
  ...rest
}: PendingButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`relative ${className}`}
    >
      {/* `contents` leaves the children in the button's flow while `invisible`
          strips only their paint, which is what keeps the box from resizing. */}
      <span className={`contents${pending ? " invisible" : ""}`}>{children}</span>
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={spinnerSize} className="text-current" />
          {pendingLabel && <span className="sr-only">{pendingLabel}</span>}
        </span>
      )}
    </button>
  );
}
