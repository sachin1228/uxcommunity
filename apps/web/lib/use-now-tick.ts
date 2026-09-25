"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for anything that says something about *now*.
 *
 * Several surfaces in the app are statements about the current moment rather
 * than about a row: the calendar badge on an event room's DP (TODAY / LIVE /
 * ENDED), the pin that keeps that room at the top of the sidebar until its
 * event starts, the events tab's Upcoming/Past split. Each of them is decided
 * against `Date.now()` at render — which means, without a clock of their own,
 * they only change when something *else* happens to re-render them. A room
 * left open kept saying LIVE after its event ended; a pin outlived the event it
 * announced; a card sat under "Upcoming" after it had finished. All of it
 * corrected itself on the next reload, which is exactly the tell.
 *
 * This hook is that clock: it re-renders its caller on an interval, all in
 * step. Subscribers share one timer — the fastest cadence anyone asked for —
 * so a sidebar of event rooms and a list of event cards cost one interval
 * between them, and every surface flips at the same instant instead of each
 * keeping its own slightly different idea of "now".
 *
 * The default cadence is deliberately coarse (30s): this is a heartbeat, not
 * an animation frame, and every subscriber re-renders on each beat.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const subscriber = { intervalMs, tick: setNow };
    subscribers.add(subscriber);
    retune();
    return () => {
      subscribers.delete(subscriber);
      retune();
    };
  }, [intervalMs]);

  return now;
}

/**
 * Run `tick` on the shared clock without rendering anything, for the surfaces
 * that own a piece of shared state rather than a piece of UI: the sidebar's
 * pinned rooms expire their pin by writing the list, and every consumer of that
 * list has to see it (see useSidebarCommunities). `tick` runs on the same beat
 * as every useNowTick in the tree, so the store and the things rendering from
 * it can never disagree about what time it is.
 *
 * Returns the unsubscribe, so it drops straight into an effect's cleanup.
 */
export function subscribeToNowTick(
  tick: (now: number) => void,
  intervalMs = 30_000,
): () => void {
  const subscriber = { intervalMs, tick };
  subscribers.add(subscriber);
  retune();
  return () => {
    subscribers.delete(subscriber);
    retune();
  };
}

type Subscriber = {
  /** The cadence this caller asked for; the shared timer runs at the fastest. */
  intervalMs: number;
  tick: (now: number) => void;
};

const subscribers = new Set<Subscriber>();
let timer: ReturnType<typeof setInterval> | null = null;

/** The cadence the shared timer should currently run at, or Infinity for none. */
function sharedCadence(): number {
  let fastest = Infinity;
  for (const subscriber of subscribers) {
    fastest = Math.min(fastest, subscriber.intervalMs);
  }
  return fastest;
}

/**
 * Restart the shared timer at the current cadence — on every subscribe and
 * unsubscribe, since either can change the fastest one. One beat is delivered
 * to every subscriber from the same instant, so no two of them can disagree
 * about what time it is.
 */
function retune(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const cadence = sharedCadence();
  if (!Number.isFinite(cadence)) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const subscriber of subscribers) subscriber.tick(now);
  }, cadence);
}
