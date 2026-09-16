/**
 * One bus for community card mutations.
 *
 * Threads, showcase posts, resources and events are rendered by the same four
 * card components in the community tabs, the homepage feed and the profile
 * activity tabs. Each of those surfaces keeps its own list state (and its own
 * request-cache entry), so a like/save/edit/delete performed on one surface
 * used to leave the others showing pre-mutation data until they refetched.
 *
 * Every card interaction that the server has confirmed publishes a
 * `ContentChange` here. Mounted lists subscribe and merge the change into their
 * items, and a list that mounts later (route change, tab switch) drains the
 * changes it has not seen yet — so "change it anywhere" always shows up
 * everywhere, without a refetch and without a second write path.
 *
 * The change is a *projection* of the mutation, never the source of truth: the
 * database row (written through the existing community API routes) remains the
 * single source of truth, and this bus only carries what those routes returned.
 */

export type ContentKind = "thread" | "event" | "resource" | "showcase";

export type ContentChange = {
  kind: ContentKind;
  id: string;
  /** Field-level patch merged into every card for this item. */
  patch?: Record<string, unknown>;
  /** The item was deleted — drop it from every list. */
  removed?: boolean;
  /** The item was just created — lists that don't already hold it must refetch. */
  created?: boolean;
};

type ContentChangeListener = (change: ContentChange) => void;

/** Upper bound on undelivered changes (they are tiny field patches). */
const MAX_PENDING = 200;

const listeners = new Set<ContentChangeListener>();

/**
 * Changes no mounted list has applied yet, keyed `${kind}:${id}` — a list that
 * mounts after a mutation still starts from post-mutation data. Entries are
 * taken (and removed) by the first list that consumes that kind.
 */
const pending = new Map<string, ContentChange>();

function keyOf(change: ContentChange): string {
  return `${change.kind}:${change.id}`;
}

/** Merge two changes for the same card; a delete supersedes every field patch. */
function mergeChange(previous: ContentChange | undefined, change: ContentChange): ContentChange {
  if (previous?.removed || change.removed) {
    return { kind: change.kind, id: change.id, removed: true };
  }
  return {
    ...previous,
    ...change,
    ...(previous?.patch || change.patch
      ? { patch: { ...previous?.patch, ...change.patch } }
      : {}),
  };
}

/**
 * Announce a confirmed mutation. Safe to call from any card callback: no
 * listener (nothing mounted) simply means the change waits in the queue for the
 * next list that cares about this kind.
 */
export function publishContentChange(change: ContentChange): void {
  if (!change.id) return;

  const key = keyOf(change);
  const merged = mergeChange(pending.get(key), change);
  pending.delete(key);
  pending.set(key, merged);
  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }

  for (const listener of [...listeners]) listener(merged);
}

export function subscribeContentChanges(listener: ContentChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Take every queued change for `kind` (all kinds when omitted/null) and clear
 * those entries. Called by a list as it mounts so it can catch up on mutations
 * performed while it was unmounted.
 */
export function consumeContentChanges(kind?: ContentKind | null): ContentChange[] {
  const taken: ContentChange[] = [];
  for (const [key, change] of pending) {
    if (kind && change.kind !== kind) continue;
    taken.push(change);
    pending.delete(key);
  }
  return taken;
}

/** How many changes are waiting to be applied (telemetry/tests). */
export function pendingContentChangeCount(): number {
  return pending.size;
}

export function clearContentChanges(): void {
  pending.clear();
  listeners.clear();
}

/**
 * Merge changes into a list of cards. `kindOf` may be a fixed kind (community
 * tabs render one kind each) or a resolver for feed lists, which mix kinds.
 *
 * Deletes drop the card; everything else is a shallow field merge. Applying the
 * same change twice is a no-op, so replaying queued changes is always safe.
 */
export function applyContentChanges<T extends { id: string }>(
  items: T[],
  changes: ContentChange[],
  kindOf: ContentKind | ((item: T) => ContentKind | null | undefined),
): T[] {
  if (!changes.length) return items;
  const resolve = typeof kindOf === "function" ? kindOf : () => kindOf;

  let next = items;
  for (const change of changes) {
    if (change.removed) {
      next = next.filter((item) => !(resolve(item) === change.kind && item.id === change.id));
      continue;
    }
    const patch = change.patch;
    if (!patch || !Object.keys(patch).length) continue;
    next = next.map((item) =>
      resolve(item) === change.kind && item.id === change.id ? { ...item, ...patch } : item,
    );
  }
  return next;
}

/** True when this change means `scope`-based lists need a refetch. */
export function changeNeedsRefetch(change: ContentChange): boolean {
  return change.created === true || change.removed === true || change.patch?.user_saved === true;
}
