import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification, type NotificationType } from "@/lib/notifications";
import { logEvent } from "@/lib/observability/log";
import { sendExpoPushBatches, type ExpoPushMessage } from "@/lib/push/expo";
import {
  dueStages,
  lifecycleHref,
  lifecycleNotice,
  STAGE_CATCH_UP_MS,
  type EventStage,
  type LifecycleEvent,
} from "./lifecycle";

/**
 * The event reminder fan-out behind the every-minute cron.
 *
 * One run:
 *   1. finds the events whose lifecycle moment is due (see ./lifecycle.ts),
 *   2. claims (event, stage, member) rows from
 *      event_notification_deliveries — the claim is what makes overlapping or
 *      retried runs safe,
 *   3. writes the in-app notification (which realtime pushes to open apps),
 *   4. sends the Expo push to every registered device.
 *
 * The audience is the people who said they are going (event_rsvps, which
 * includes the host). Un-RSVPing therefore also stops the reminders; joining
 * the room alone is not a promise to show up.
 *
 * Everything is best-effort and budgeted: a run that hits its wall clock
 * reports `complete: false` and the next tick continues inside the stage's
 * catch-up window. Nothing here may throw into the cron driver.
 */

type Db = ReturnType<typeof createServiceClient>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HALF_HOUR_MS = 30 * MINUTE_MS;

/** Events considered per stage per run — enough for a busy evening, bounded. */
const MAX_EVENTS_PER_STAGE = 40;
/** Members claimed per run, across every due stage. */
const MAX_CLAIMS_PER_RUN = 1200;
/** Wall-clock budget for one run; the next tick picks up the rest. */
const RUN_BUDGET_MS = 25_000;
/** Leave this much budget for the final Expo send. */
const SEND_RESERVE_MS = 8_000;

const EVENT_COLUMNS =
  "id, title, event_date, end_date, created_at, host_timezone, host_utc_offset_minutes, community_id";

export interface LifecycleStageSummary {
  stage: EventStage;
  events: number;
  recipients: number;
}

export interface LifecycleRunSummary {
  due: LifecycleStageSummary[];
  notifications: number;
  pushMessages: number;
  deadTokens: number;
  /** False when the budget cut the run short; the next tick continues. */
  complete: boolean;
  durationMs: number;
}

interface DueWork {
  event: LifecycleEvent;
  stage: EventStage;
}

/** Claims in chunks the database will accept in one statement. */
const CLAIM_CHUNK = 500;
/** Recipient ids per token lookup, so a URL never carries a huge IN list. */
const LOOKUP_CHUNK = 200;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The events that could possibly have a moment due, one bounded query each. */
async function loadCandidates(db: Db, nowMs: number): Promise<LifecycleEvent[]> {
  const select = () =>
    db
      .from("community_events")
      .select(EVENT_COLUMNS)
      .order("event_date", { ascending: true })
      .limit(MAX_EVENTS_PER_STAGE);

  const [tomorrow, today, soon, live, ended] = await Promise.all([
    // T-24h, plus the stage's catch-up tail.
    select()
      .gte("event_date", iso(nowMs + DAY_MS - STAGE_CATCH_UP_MS))
      .lte("event_date", iso(nowMs + DAY_MS)),
    // The morning slot only exists while at least two hours remain.
    select()
      .gte("event_date", iso(nowMs + 2 * HOUR_MS))
      .lte("event_date", iso(nowMs + DAY_MS)),
    select()
      .gte("event_date", iso(nowMs))
      .lte("event_date", iso(nowMs + HALF_HOUR_MS)),
    select()
      .gte("event_date", iso(nowMs - STAGE_CATCH_UP_MS))
      .lte("event_date", iso(nowMs)),
    db
      .from("community_events")
      .select(EVENT_COLUMNS)
      .not("end_date", "is", null)
      .gte("end_date", iso(nowMs - STAGE_CATCH_UP_MS))
      .lte("end_date", iso(nowMs))
      .order("end_date", { ascending: true })
      .limit(MAX_EVENTS_PER_STAGE),
  ]);

  const rows = [
    ...(tomorrow.data ?? []),
    ...(today.data ?? []),
    ...(soon.data ?? []),
    ...(live.data ?? []),
    ...(ended.data ?? []),
  ];
  const byId = new Map<string, LifecycleEvent>();
  for (const row of rows) {
    const event = row as unknown as LifecycleEvent;
    if (event?.id) byId.set(event.id, event);
  }
  return [...byId.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Bounded concurrency for the database writes; order does not matter. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export async function runEventLifecycleNotifications(
  db: Db = createServiceClient(),
  options: { now?: Date; budgetMs?: number } = {},
): Promise<LifecycleRunSummary> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const deadline = startedAt + (options.budgetMs ?? RUN_BUDGET_MS);

  const summary: LifecycleRunSummary = {
    due: [],
    notifications: 0,
    pushMessages: 0,
    deadTokens: 0,
    complete: true,
    durationMs: 0,
  };

  // 1. What is due right now.
  let work: DueWork[] = [];
  try {
    const candidates = await loadCandidates(db, nowMs);
    for (const event of candidates) {
      for (const stage of dueStages(event, now)) {
        work.push({ event, stage });
      }
    }
  } catch (error) {
    logEvent("error", { event: "event_lifecycle.candidates_failed", error });
    summary.complete = false;
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  if (work.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const eventIds = [...new Set(work.map(({ event }) => event.id))];

  // 2. Everything the run needs, in three batched reads.
  const [rsvpResult, deliveryResult, roomResult] = await Promise.all([
    db.from("event_rsvps").select("event_id, user_id").in("event_id", eventIds),
    db
      .from("event_notification_deliveries")
      .select("event_id, user_id, stage")
      .in("event_id", eventIds),
    db.from("communities").select("id, event_id").in("event_id", eventIds),
  ]);

  if (rsvpResult.error || deliveryResult.error || roomResult.error) {
    logEvent("error", {
      event: "event_lifecycle.audience_failed",
      error: rsvpResult.error ?? deliveryResult.error ?? roomResult.error,
    });
    summary.complete = false;
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const recipientsByEvent = new Map<string, string[]>();
  for (const row of (rsvpResult.data ?? []) as Array<{ event_id: string; user_id: string }>) {
    const list = recipientsByEvent.get(row.event_id) ?? [];
    list.push(row.user_id);
    recipientsByEvent.set(row.event_id, list);
  }

  const delivered = new Set<string>();
  for (const row of (deliveryResult.data ?? []) as Array<{
    event_id: string;
    user_id: string;
    stage: string;
  }>) {
    delivered.add(`${row.event_id}|${row.stage}|${row.user_id}`);
  }

  const roomByEvent = new Map<string, string>();
  for (const row of (roomResult.data ?? []) as Array<{ id: string; event_id: string | null }>) {
    if (row.event_id && !roomByEvent.has(row.event_id)) roomByEvent.set(row.event_id, row.id);
  }

  // 3. Claim every (event, stage, member) still owed.
  const claims: Array<{ event_id: string; user_id: string; stage: EventStage }> = [];
  for (const { event, stage } of work) {
    const recipients = recipientsByEvent.get(event.id) ?? [];
    for (const userId of recipients) {
      if (delivered.has(`${event.id}|${stage}|${userId}`)) continue;
      claims.push({ event_id: event.id, user_id: userId, stage });
      if (claims.length >= MAX_CLAIMS_PER_RUN) break;
    }
    if (claims.length >= MAX_CLAIMS_PER_RUN) break;
  }

  const claimed: typeof claims = [];
  for (const group of chunk(claims, CLAIM_CHUNK)) {
    if (Date.now() > deadline - SEND_RESERVE_MS) {
      summary.complete = false;
      break;
    }
    const { data, error } = await db
      .from("event_notification_deliveries")
      .upsert(group, { onConflict: "event_id,user_id,stage", ignoreDuplicates: true })
      .select("event_id, user_id, stage");
    if (error) {
      logEvent("error", { event: "event_lifecycle.claim_failed", error });
      summary.complete = false;
      continue;
    }
    claimed.push(...((data ?? []) as typeof claims));
  }

  if (claimed.length === 0) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  // 4. In-app rows. Realtime carries them to any open app; the list and the
  // bell pick them up on the next foreground.
  const workByKey = new Map(work.map((entry) => [`${entry.event.id}|${entry.stage}`, entry]));
  let notificationFailures = 0;
  await runPool(claimed, 8, async (claim) => {
    const entry = workByKey.get(`${claim.event_id}|${claim.stage}`);
    if (!entry) return;
    const roomId = roomByEvent.get(claim.event_id) ?? null;
    const notice = lifecycleNotice(entry.event, entry.stage, {
      hasRoom: Boolean(roomId),
      now,
    });
    const result = await createNotification(db, {
      userId: claim.user_id,
      actorId: null,
      communityId: entry.event.community_id,
      type: notice.type as NotificationType,
      entityType: "event",
      entityId: entry.event.id,
      title: notice.title,
      body: notice.body,
      href: lifecycleHref(entry.event),
      metadata: {
        stage: entry.stage,
        event_id: entry.event.id,
        chat_community_id: roomId,
      },
    });
    if (result.ok) {
      summary.notifications += 1;
    } else {
      notificationFailures += 1;
    }
  });
  if (notificationFailures > 0) {
    logEvent("warn", {
      event: "event_lifecycle.notification_failures",
      count: notificationFailures,
    });
  }

  // 5. Push. One collapse id per event, so the five moments replace each other
  // in the shade instead of stacking; a member who missed the reminder wakes to
  // the latest state, not a pile.
  const userIds = [...new Set(claimed.map((claim) => claim.user_id))];
  const tokensByUser = new Map<string, string[]>();
  for (const group of chunk(userIds, LOOKUP_CHUNK)) {
    const { data, error } = await db
      .from("push_tokens")
      .select("user_id, token")
      .in("user_id", group);
    if (error) {
      logEvent("warn", { event: "event_lifecycle.tokens_failed", error });
      break;
    }
    for (const row of (data ?? []) as Array<{ user_id: string; token: string }>) {
      const tokens = tokensByUser.get(row.user_id) ?? [];
      tokens.push(row.token);
      tokensByUser.set(row.user_id, tokens);
    }
  }

  const messages: ExpoPushMessage[] = [];
  for (const claim of claimed) {
    const entry = workByKey.get(`${claim.event_id}|${claim.stage}`);
    const tokens = tokensByUser.get(claim.user_id);
    if (!entry || !tokens?.length) continue;
    const roomId = roomByEvent.get(claim.event_id) ?? null;
    const notice = lifecycleNotice(entry.event, entry.stage, {
      hasRoom: Boolean(roomId),
      now,
    });
    for (const token of tokens) {
      messages.push({
        to: token,
        title: notice.title,
        body: notice.body,
        sound: "default",
        channelId: "events",
        collapseId: `event-lifecycle-${entry.event.id}`,
        data: {
          type: "event_lifecycle",
          stage: entry.stage,
          eventId: entry.event.id,
          communityId: roomId,
          href: lifecycleHref(entry.event),
        },
      });
    }
  }

  if (messages.length > 0) {
    try {
      const delivery = await sendExpoPushBatches(messages, {
        deadline: Math.max(Date.now() + 1_000, deadline),
      });
      summary.pushMessages = delivery.delivered;
      if (delivery.deadTokens.length > 0) {
        await db.from("push_tokens").delete().in("token", delivery.deadTokens);
        summary.deadTokens = delivery.deadTokens.length;
      }
    } catch (error) {
      // Push is the waking half only — the in-app rows are already committed.
      logEvent("error", { event: "event_lifecycle.push_failed", error });
    }
  }

  // 6. Per-stage counts for the cron's log line.
  const byStage = new Map<EventStage, { events: Set<string>; recipients: number }>();
  for (const claim of claimed) {
    const entry = byStage.get(claim.stage) ?? { events: new Set<string>(), recipients: 0 };
    entry.events.add(claim.event_id);
    entry.recipients += 1;
    byStage.set(claim.stage, entry);
  }
  summary.due = [...byStage.entries()].map(([stage, entry]) => ({
    stage,
    events: entry.events.size,
    recipients: entry.recipients,
  }));

  summary.durationMs = Date.now() - startedAt;
  return summary;
}
