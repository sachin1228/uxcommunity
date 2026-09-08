const clockFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const yearFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric",
});
const fullFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
});

function calendarDay(date: Date): number {
  // Compare local calendar dates without letting 23/25-hour DST days skew the result.
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function formatSidebarTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) return null;

  const daysAgo = calendarDay(now) - calendarDay(date);
  let label: string;
  if (daysAgo === 0) label = clockFormat.format(date);
  else if (daysAgo === 1) label = "Yesterday";
  else if (daysAgo > 1 && daysAgo < 7) label = weekdayFormat.format(date);
  else if (date.getFullYear() === now.getFullYear()) label = dateFormat.format(date);
  else label = yearFormat.format(date);

  return { label, dateTime: date.toISOString(), full: fullFormat.format(date) };
}
