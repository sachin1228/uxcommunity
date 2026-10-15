/**
 * Shapes the row returned by the atomic `create_notification` RPC
 * (migration 20260928140000_notification_dedupe.sql) into the realtime event
 * the notification room expects.
 *
 * The client (`lib/use-notifications.ts`) treats `insert` and `update`
 * differently: an `insert` PREPENDS a new row and increments the unread badge,
 * while an `update` patches a row it already holds. So the RPC's `inserted`
 * flag is not cosmetic — a deduplicated event (an existing unread row that was
 * aggregated into) must publish `update`, never `insert`, or the bell would
 * show the same notification twice and count the unread badge twice.
 *
 * Kept free of `server-only` imports so the two payload shapes can be unit
 * tested directly; `lib/notifications.ts` owns the actual publish call.
 */

/** One row of the `create_notification` RPC result. */
export interface NotificationCreatedRow {
  id: string;
  user_id: string;
  actor_id: string | null;
  community_id: string | null;
  type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  href: string;
  metadata: unknown;
  read_at: string | null;
  created_at: string;
  /** True only when this call created the row; false when it aggregated. */
  inserted: boolean;
}

export interface NotificationRealtimeEvent {
  room: string;
  topic: "insert" | "update";
  data: unknown;
}

/**
 * Fold an `update` event's `next` payload into the row the client already
 * holds.
 *
 * The rule is MERGE, never replace, and that is a correctness requirement
 * rather than a preference: the two publishers of this topic send different
 * amounts of the row. The aggregation path (`notificationRealtimeEvent` above)
 * sends the whole row; "mark all read" sends only `{ id, read_at }`, because
 * the ids are all the handler needs and re-reading every unread row to publish
 * bodies cost egress for no benefit. A replace would therefore blank the title,
 * body and href of every row another tab had open.
 *
 * A patch for an id the list does not hold is ignored — the list is a bounded
 * window (MAX_ITEMS) and an event for a row outside it is not this client's
 * business.
 */
export function applyNotificationPatch<T extends { id: string }>(
  items: T[],
  patch: Partial<T> & { id: string },
): T[] {
  return items.map((item) => (item.id === patch.id ? { ...item, ...patch } : item));
}

export function notificationRealtimeEvent(
  row: NotificationCreatedRow,
  room: string,
): NotificationRealtimeEvent {
  if (row.inserted) {
    // The flat row the `insert` handler destructures — the same fields the old
    // INSERT ... .select() path published.
    return {
      room,
      topic: "insert",
      data: {
        id: row.id,
        user_id: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        href: row.href,
        read_at: row.read_at,
        created_at: row.created_at,
      },
    };
  }

  // The `{ next, old }` envelope the `update` handler destructures. `old` is
  // always unread because only unread rows are ever aggregated into.
  return {
    room,
    topic: "update",
    data: {
      next: {
        id: row.id,
        user_id: row.user_id,
        actor_id: row.actor_id,
        community_id: row.community_id,
        type: row.type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        title: row.title,
        body: row.body,
        href: row.href,
        read_at: row.read_at,
        created_at: row.created_at,
      },
      old: { id: row.id, read_at: null },
    },
  };
}
