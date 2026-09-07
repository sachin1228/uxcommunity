"use client";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/shadcn/popover";
import { cn } from "@/lib/utils";

interface DropdownMenuProps {
  /** External trigger retained for rich panels such as notifications. */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
  gap?: number;
  className?: string;
}

/** Rich panels use Popover; action lists compose the shadcn DropdownMenu directly. */
export function DropdownMenu({ triggerRef, open, onClose, children, align = "right", gap = 4, className }: DropdownMenuProps) {
  return (
    <Popover open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor virtualRef={triggerRef} />
      <PopoverContent
        align={align === "right" ? "end" : "start"}
        sideOffset={gap}
        collisionPadding={8}
        className={cn("max-w-[calc(100vw-1rem)] p-0", className)}
        onInteractOutside={(event) => { if (event.target instanceof Node && triggerRef.current?.contains(event.target)) event.preventDefault(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}
      >{children}</PopoverContent>
    </Popover>
  );
}
