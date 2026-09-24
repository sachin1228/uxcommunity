import type { ContentEventKind } from "./cache";

/**
 * Optional rich fields the chat-timeline notification cards render. The four
 * creation routes embed what their content type carries — showcase media,
 * resource type/description/link, event cover/schedule/attendees, thread
 * attachments — before broadcasting or persisting the event.
 */
export interface ContentEventMeta {
  /** Cover/thumbnail image (showcase media, event cover, thread attachment). */
  image_url?: string | null;
  /** First video attachment (poster frame renders as the thumbnail). */
  video_poster?: string | null;
  /** Resource description / event description / thread first line. */
  description?: string | null;
  /** Resource type value ("figma", "article", …). */
  resource_type?: string | null;
  /** Resource link (rendered as "figma.com/…" subtitle). */
  url?: string | null;
  /** Event start date (ISO). */
  event_date?: string | null;
  /** Event end date (ISO). */
  end_date?: string | null;
  /** Whether the event happens online. */
  is_online?: boolean | null;
  /** RSVP count snapshot — a local seed; history re-enriches server-side. */
  rsvp_count?: number | null;
  /** Comments left on the item's own detail page, so the card can show how
   * much discussion it has. Enriched server-side per page load. */
  comment_count?: number | null;
}

/**
 * Where each content kind keeps its own comments. The four kinds have their
 * own table with their own FK column; both the page reader below and the
 * realtime republisher use this one map so the two can never disagree.
 */
export const CONTENT_COMMENT_SOURCES: Record<ContentEventKind, { table: string; column: string }> = {
  thread:   { table: "thread_comments",   column: "thread_id" },
  showcase: { table: "showcase_comments", column: "post_id" },
  resource: { table: "resource_comments", column: "resource_id" },
  event:    { table: "event_comments",    column: "event_id" },
};

/**
 * Comment counts for a page of content cards. The four kinds keep their
 * comments in their own table with their own FK column, so this is one query
 * per kind (per page, not per card), tallied in memory.
 */
export async function loadCommentCounts(
  db: { from: (table: string) => unknown },
  items: Array<{ id: string; kind: ContentEventKind }>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const byKind: Record<ContentEventKind, { table: string; column: string; ids: string[] }> = {
    thread:   { ...CONTENT_COMMENT_SOURCES.thread,   ids: [] },
    showcase: { ...CONTENT_COMMENT_SOURCES.showcase, ids: [] },
    resource: { ...CONTENT_COMMENT_SOURCES.resource, ids: [] },
    event:    { ...CONTENT_COMMENT_SOURCES.event,    ids: [] },
  };
  for (const item of items) byKind[item.kind]?.ids.push(item.id);

  await Promise.all(
    Object.values(byKind).map(async ({ table, column, ids }) => {
      if (!ids.length) return;
      const { data } = (await (db.from(table) as {
        select: (cols: string) => {
          in: (col: string, values: string[]) => Promise<{
            data: Array<Record<string, string | null>> | null;
          }>;
        };
      })
        .select(column)
        .in(column, ids)) as { data: Array<Record<string, string | null>> | null };
      for (const row of data ?? []) {
        const id = row[column];
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }),
  );
  return counts;
}

/**
 * Loads the latest RSVP counts for a page of events in one query. RSVPs are
 * created/deleted independently of the event, so the count embedded at
 * creation time goes stale — history enrichment refreshes it per page load.
 */
export async function loadRsvpCounts(
  db: { from: (table: string) => unknown },
  eventIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!eventIds.length) return counts;
  const { data } = (await (db.from("event_rsvps") as {
    select: (cols: string) => {
      in: (col: string, ids: string[]) => Promise<{ data: Array<{ event_id: string }> | null }>;
    };
  }).select("event_id").in("event_id", eventIds)) as { data: Array<{ event_id: string }> | null };
  for (const row of data ?? []) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

// ─── Per-kind visual identity (shared by the timeline cards) ────────────────

export interface KindTheme {
  /** Eyebrow label — "THREAD", "RESOURCE", … */
  label: string;
  /** Icon-tile background (light/dark-aware Geist scale stop). */
  tileBg: string;
  /** Icon color on the tile. */
  tileFg: string;
  /** Eyebrow text color. */
  accent: string;
}

export const KIND_THEME: Record<ContentEventKind, KindTheme> = {
  thread: {
    label: "Thread",
    tileBg: "var(--ds-green-200)",
    tileFg: "var(--ds-green-800)",
    accent: "var(--ds-green-800)",
  },
  showcase: {
    label: "Showcase",
    tileBg: "var(--ds-purple-200)",
    tileFg: "var(--ds-purple-700)",
    accent: "var(--ds-purple-700)",
  },
  resource: {
    label: "Resource",
    tileBg: "var(--ds-purple-200)",
    tileFg: "var(--ds-purple-700)",
    accent: "var(--ds-purple-700)",
  },
  event: {
    label: "Event",
    tileBg: "var(--ds-amber-200)",
    tileFg: "var(--ds-amber-800)",
    accent: "var(--ds-amber-800)",
  },
};

/** First line of a text field, truncated for the subtitle. */
export function firstLine(text: string, max = 90): string {
  const line = text.trim().replace(/\s+/g, " ");
  if (line.length <= max) return line;
  return `${line.slice(0, max).trimEnd()}…`;
}

/**
 * Thread and showcase bodies store their whole text in `title`. The chat card
 * renders the first line as the title and the remaining lines as the
 * description — matching how the detail pages open with a headline + body.
 */
export function splitBody(text: string): { title: string; subtitle: string | null } {
  const normalized = text.trim();
  if (!normalized) return { title: "", subtitle: null };
  const nl = normalized.search(/\r?\n/);
  if (nl === -1) return { title: normalized, subtitle: null };
  const title = normalized.slice(0, nl).trim();
  const rest = normalized.slice(nl).trim();
  return { title: title || normalized, subtitle: rest ? firstLine(rest, 110) : null };
}

/** "figma.com/design/xyz" — hostname (+ first path segment) for link subtitles. */
export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean)[0];
    return segment ? `${parsed.hostname}${parsed.pathname === "/" ? "" : `/${segment}…`}` : parsed.hostname;
  } catch {
    return url;
  }
}

/** "Sat, Sep 28 · 5:00 PM" from an ISO start (year dropped — community events are near-term). */
export function fmtEventSchedule(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}
