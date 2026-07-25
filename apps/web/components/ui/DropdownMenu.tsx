"use client";

/**
 * Portal-based dropdown menu — SSR-safe.
 *
 * Renders children into document.body via createPortal so the menu is never
 * clipped by a parent's stacking context (no z-index battles). Positions
 * itself with `position: fixed` derived from the trigger element's bounding
 * rect and sits at z-[9999].
 *
 * SSR safety: nothing is rendered until after the first client-side paint
 * (mounted state), and the portal is fully unmounted when closed — no
 * show/hide toggling that would cause hydration mismatches.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownMenuProps {
  /** Ref to the button that opens the menu — used for positioning. */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Which edge of the trigger to align to (default: "right"). */
  align?: "left" | "right";
  /** Gap between trigger bottom and menu top in px (default: 4). */
  gap?: number;
  className?: string;
}

export function DropdownMenu({
  triggerRef,
  open,
  onClose,
  children,
  align = "right",
  gap = 4,
  className = "",
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Only render on the client — prevents SSR/hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /** Reposition the menu relative to the trigger. */
  const reposition = useCallback(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${r.bottom + gap}px`;
    if (align === "right") {
      menu.style.right = `${window.innerWidth - r.right}px`;
      menu.style.left = "auto";
    } else {
      menu.style.left = `${r.left}px`;
      menu.style.right = "auto";
    }
  }, [triggerRef, align, gap]);

  /* Reposition whenever the menu opens or the viewport scrolls/resizes. */
  useEffect(() => {
    if (!open) return;
    // One frame so the portal node is in the DOM before measuring.
    const raf = requestAnimationFrame(reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  /* Close on outside click or Escape. */
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, triggerRef]);

  // Nothing on the server or when closed — mount/unmount keeps React's
  // server and client HTML in sync and avoids parentNode removal errors.
  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", zIndex: 9999 }}
      className={`min-w-[8rem] rounded-xl bg-surface-raised border border-white/[0.1] shadow-2xl overflow-hidden
        animate-in fade-in zoom-in-95 duration-100 origin-top-right
        ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
