"use client";

/**
 * Global navigation protection.
 *
 * Prevents rapid repeated clicks from starting duplicate route transitions to
 * the same destination. The guard is time-based (not promise-based, because
 * the App Router's `router.push`/`replace` do not return a promise), so it
 * can never permanently block navigation:
 *
 *   - A push/replace to a destination seen within the lock window is ignored.
 *   - The lock expires automatically (default 800 ms), after which the same
 *     destination can be navigated to again.
 *   - `back()` gets its own short lock to swallow double-back presses.
 *
 * Use `useGuardedRouter()` inside components, or `createNavigationGuard()` for
 * imperative use outside React.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";

/** Structural subset of the App Router instance used by this guard. */
export interface RouterLike {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
}

export const NAVIGATION_LOCK_MS = 800;
export const BACK_LOCK_MS = 300;

const pendingNavigations = new Map<string, number>();
let lastBackAt = 0;

/** True when a push/replace to `href` should proceed (not a duplicate). */
export function allowNavigation(href: string, lockMs = NAVIGATION_LOCK_MS): boolean {
  const now = Date.now();
  const last = pendingNavigations.get(href);
  if (last !== undefined && now - last < lockMs) return false;

  // Opportunistically prune entries older than the lock window.
  if (pendingNavigations.size > 50) {
    for (const [key, at] of pendingNavigations) {
      if (now - at >= lockMs) pendingNavigations.delete(key);
    }
  }

  pendingNavigations.set(href, now);
  return true;
}

/** Clears all recorded navigation locks (used by tests and HMR). */
export function resetNavigationGuard() {
  pendingNavigations.clear();
  lastBackAt = 0;
}

/** True when `router.back()` should proceed (not a double-back). */
export function allowBack(lockMs = BACK_LOCK_MS): boolean {
  const now = Date.now();
  if (now - lastBackAt < lockMs) return false;
  lastBackAt = now;
  return true;
}

export interface NavigationGuard {
  /** Pushes to `href` unless a transition to it is already pending. */
  push: (href: string) => void;
  /** Replaces at `href` unless a transition to it is already pending. */
  replace: (href: string) => void;
  /** Navigates back unless a back navigation is already pending. */
  back: () => void;
}

/** Creates a guard bound to a router instance (works outside React too). */
export function createNavigationGuard(
  router: RouterLike,
  lockMs = NAVIGATION_LOCK_MS,
): NavigationGuard {
  return {
    push(href: string) {
      if (allowNavigation(href, lockMs)) router.push(href);
    },
    replace(href: string) {
      if (allowNavigation(href, lockMs)) router.replace(href);
    },
    back() {
      if (allowBack()) router.back();
    },
  };
}

/** React hook — returns push/replace/back that deduplicate identical navigations. */
export function useGuardedRouter(lockMs = NAVIGATION_LOCK_MS): NavigationGuard {
  const router = useRouter();
  return useMemo(() => createNavigationGuard(router, lockMs), [router, lockMs]);
}
