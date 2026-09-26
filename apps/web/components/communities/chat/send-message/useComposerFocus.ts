"use client";

import { useEffect } from "react";

/**
 * Focus the composer when the community changes, and route stray printable
 * keystrokes (typed while nothing editable is focused) into it.
 */
export function useComposerFocus(
  inputRef: React.RefObject<HTMLTextAreaElement>,
  communityId: string,
): void {
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef, communityId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || active?.isContentEditable) return;

      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

      inputRef.current?.focus();
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [inputRef, communityId]);
}
