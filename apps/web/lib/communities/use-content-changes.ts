"use client";

import { useEffect, useRef } from "react";
import {
  consumeContentChanges,
  subscribeContentChanges,
  type ContentChange,
  type ContentKind,
} from "./content-sync";

/**
 * Keeps one card list in sync with community mutations from every other list.
 *
 * On mount the list drains the changes queued while it was unmounted, then
 * receives every subsequent change live. Pass a `kind` for single-kind lists
 * (a community tab) or `null` for mixed feeds (the homepage and profile feeds),
 * which receive every kind and resolve each card's kind themselves.
 */
export function useContentChanges(
  kind: ContentKind | null,
  onChanges: (changes: ContentChange[]) => void,
): void {
  const handlerRef = useRef(onChanges);

  // Keep the ref in sync after render — writing refs during render is
  // disallowed by the react-hooks/refs lint rule.
  useEffect(() => {
    handlerRef.current = onChanges;
  });

  useEffect(() => {
    const queued = consumeContentChanges(kind);
    if (queued.length) handlerRef.current(queued);

    return subscribeContentChanges((change) => {
      if (kind && change.kind !== kind) return;
      handlerRef.current([change]);
    });
  }, [kind]);
}
