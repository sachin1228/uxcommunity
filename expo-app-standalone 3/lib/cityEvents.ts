/**
 * City events client — the mobile side of the web workspace page at
 * /dashboard/events: the public events of the viewer's own city, upcoming and
 * past.
 *
 * `/api/events/city` is the very endpoint the web page's "Load more" pages
 * through; the city is always the viewer's own, so the client never names it.
 * The cursor is the compound `phase|event_date|id`:
 *
 *   • the upcoming phase's first page is requested with no cursor at all;
 *   • the past phase's first page is the literal `past`;
 *   • the `past` a spent upcoming page hands back means "that phase has no
 *     further rows", which the two tabs here fold into null.
 */

import { apiFetch } from './api';
import type { CommunityEvent } from './communityContent';

export type CityEventPhase = 'upcoming' | 'past';

/**
 * One city event card: the community events row plus the community
 * attribution the card draws ("posted in …").
 */
export interface CityEventItem extends CommunityEvent {
  community_name?: string | null;
  community_image?: string | null;
}

export interface CityEventPage {
  events: CityEventItem[];
  /** The phase's next cursor, or null once that phase has no further rows. */
  nextCursor: string | null;
}

/** The first page of a phase: no cursor (upcoming) or the `past` sentinel. */
export function firstPageCursor(phase: CityEventPhase): string | null {
  return phase === 'past' ? 'past' : null;
}

/** One page of one phase, at `cursor` (a real page cursor or a first-page value). */
export async function getCityEventPage(cursor: string | null): Promise<CityEventPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const { data } = await apiFetch<{ events?: CityEventItem[]; nextCursor?: string | null }>(
    `/api/events/city${query}`,
  );

  const next = data.nextCursor ?? null;
  return {
    events: data.events ?? [],
    // "past" is the upcoming phase handing over, not a page of its own.
    nextCursor: next === 'past' ? null : next,
  };
}
