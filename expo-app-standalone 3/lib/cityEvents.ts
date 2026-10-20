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
 *     further rows", which this client folds into null.
 */

import { apiFetch } from './api';
import type { CommunityEvent } from './communityContent';

export type CityEventPhase = 'upcoming' | 'past';

/** The web Events page's type filter — a single choice over `is_online`. */
export type CityEventTypeFilter = 'all' | 'online' | 'in-person';

/** The web Events page's start-date window. */
export type CityEventDateFilter = 'any' | 'today' | 'week' | 'month';

export interface CityEventFilters {
  type: CityEventTypeFilter;
  date: CityEventDateFilter;
}

export const DEFAULT_CITY_EVENT_FILTERS: CityEventFilters = { type: 'all', date: 'any' };

/**
 * The event's start-date window as [from, to) instants, using the viewer's
 * own clock — the same boundaries the web page sends (event-filters.ts).
 */
export function cityEventDateWindow(
  filter: CityEventDateFilter,
  now: Date = new Date(),
): { from: string | null; to: string | null } {
  if (filter === 'any') return { from: null, to: null };

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  if (filter === 'today') {
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    return { from: dayStart.toISOString(), to: nextDay.toISOString() };
  }

  if (filter === 'week') {
    // The calendar week containing today, starting Monday.
    const sinceMonday = (dayStart.getDay() + 6) % 7;
    const weekStart = new Date(dayStart);
    weekStart.setDate(weekStart.getDate() - sinceMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return { from: weekStart.toISOString(), to: weekEnd.toISOString() };
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: monthStart.toISOString(), to: monthEnd.toISOString() };
}

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
export async function getCityEventPage(
  cursor: string | null,
  filters: CityEventFilters = DEFAULT_CITY_EVENT_FILTERS,
): Promise<CityEventPage> {
  const params: string[] = [];
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  if (filters.type !== 'all') params.push(`type=${encodeURIComponent(filters.type)}`);
  const { from, to } = cityEventDateWindow(filters.date);
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  if (to) params.push(`to=${encodeURIComponent(to)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';

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
