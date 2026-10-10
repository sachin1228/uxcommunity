/**
 * The Events page's filter row, as pure data.
 *
 * The type filter is a single choice over the event's is_online flag; the
 * date filter is a window over the event's *start* — "Today" means events
 * that start today, which is what a listing means by the word. The windows
 * are computed from the viewer's own clock (so the boundaries are the ones
 * on their wall) and sent to the API as absolute instants; the API and the
 * database only compare them.
 */

export type EventTypeFilter = "all" | "online" | "in-person";
export type EventDateFilter = "any" | "today" | "week" | "month";

export const EVENT_TYPE_OPTIONS: { value: EventTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "in-person", label: "In person" },
];

export const EVENT_DATE_OPTIONS: { value: EventDateFilter; label: string }[] = [
  { value: "any", label: "Any date" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

/** The event's start-date window for a filter, as [from, to) instants. */
export function dateWindow(
  filter: EventDateFilter,
  now: Date,
): { from: string | null; to: string | null } {
  if (filter === "any") return { from: null, to: null };

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  if (filter === "today") {
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    return { from: dayStart.toISOString(), to: nextDay.toISOString() };
  }

  if (filter === "week") {
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
 * The query string /api/events/city expects for a filter combination. An
 * empty result means "no filters" — the URL is sent as-is then.
 */
export function filterQuery(
  type: EventTypeFilter,
  date: EventDateFilter,
  now: Date,
): URLSearchParams {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  const { from, to } = dateWindow(date, now);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
}
