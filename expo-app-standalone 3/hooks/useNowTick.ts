/**
 * A shared clock for surfaces that announce a moment — the event badges that
 * turn LIVE/ENDED with the event's window.
 *
 * One module-level interval serves every subscriber (the web app's
 * `use-now-tick` does the same), so a list of twenty event rooms costs a
 * single timer, and the tick stops entirely when nothing is subscribed.
 */
import { useEffect, useState } from 'react';

/**
 * How often subscribers re-read the clock. The badge announces a moment — a
 * window opening or closing — so it has to notice one arriving on its own. A
 * quarter minute is close enough that a member watching the room sees the
 * badge turn without touching anything.
 */
export const NOW_TICK_MS = 15_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function startTicker() {
  if (timer) return;
  timer = setInterval(() => {
    for (const listener of listeners) listener();
  }, NOW_TICK_MS);
}

function stopTickerIfIdle() {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** `Date.now()` refreshed on the shared tick. */
export function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const listener = () => setNow(Date.now());
    listeners.add(listener);
    startTicker();
    // Catch up immediately: the app may have been backgrounded since the
    // state was seeded, and a stale first paint would keep saying LIVE.
    listener();
    return () => {
      listeners.delete(listener);
      stopTickerIfIdle();
    };
  }, []);

  return now;
}
