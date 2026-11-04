import type { Message } from './communities';
import type { CommunityMessageWindow } from './chatCache';
import { CHAT_MESSAGE_RETENTION_DAYS, compareChatTimeline } from './chat';
import { drainCatchUpPages, latestMessageCursor, mergeMessagePage, type MessageCursor } from './realtimeCatchUp';

export interface CommunityMessageSnapshot extends CommunityMessageWindow {
  hydrated: boolean;
  hasMore: boolean;
}

interface StoreOptions {
  load(userId: string, communityId: string): Promise<CommunityMessageWindow | null>;
  save(userId: string, communityId: string, window: CommunityMessageWindow): Promise<void>;
  fetchLatest(communityId: string, userId: string): Promise<Message[]>;
  fetchAfter(communityId: string, cursor: MessageCursor): Promise<Message[]>;
  now?: () => number;
  maxRooms?: number;
  writeDelayMs?: number;
}

type Listener = (snapshot: CommunityMessageSnapshot, source: 'hydrate' | 'sync' | 'live') => void;
interface Entry {
  snapshot: CommunityMessageSnapshot;
  listeners: Set<Listener>;
  hydration?: Promise<void>;
  sync?: Promise<void>;
  syncAgain: boolean;
  lastSyncAt: number;
  saveTimer?: ReturnType<typeof setTimeout>;
}

const PAGE_SIZE = 50;
const WINDOW_SIZE = 120;

/** A push/live row can arrive before its quoted message. Fill previews from
 * API rows without overwriting a newer local edit, reaction or upload preview. */
export function enrichMessagePreviews(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(incoming.map((row) => [row.id, row]));
  let changed = false;
  const rows = current.map((row) => {
    const full = byId.get(row.id);
    if (!full || row.deleted_at) return row;
    if (full.deleted_at) {
      changed = true;
      return { ...row, deleted_at: full.deleted_at, content: null, image_url: null, reply_to: null, reactions: [] };
    }
    const users = row.users ?? full.users;
    const reply = row.reply_to?.content ? row.reply_to : full.reply_to ?? row.reply_to;
    const contentReply = row.reply_to_content ?? full.reply_to_content;
    const newerEdit = full.edited_at && (!row.edited_at || full.edited_at > row.edited_at);
    if (!newerEdit && users === row.users && reply === row.reply_to && contentReply === row.reply_to_content) return row;
    changed = true;
    return { ...row, users, reply_to: reply, reply_to_content: contentReply,
      ...(newerEdit ? { content: full.content, edited_at: full.edited_at } : {}) };
  });
  return changed ? rows : current;
}

/**
 * Account-scoped, observable message windows shared by navigation, realtime
 * and the open chat. Native I/O and HTTP are supplied by the runtime adapter.
 * Display rows and the confirmed sync cursor are deliberately separate:
 * receiving M12 before recovering M11 must never cause an `after=M12` fetch.
 */
export function createCommunityMessageStore(options: StoreOptions) {
  const now = options.now ?? Date.now;
  const rooms = new Map<string, Entry>();
  let userId: string | null = null;
  let epoch = 0;

  function active(owner: string, generation = epoch) {
    return owner === userId && generation === epoch;
  }

  function window(rows: Message[]): Message[] {
    const cutoff = now() - CHAT_MESSAGE_RETENTION_DAYS * 86_400_000;
    return rows.filter((row) => !row.id.startsWith('temp-') && Date.parse(row.created_at) >= cutoff)
      .sort(compareChatTimeline).slice(-WINDOW_SIZE);
  }

  function flush(communityId: string, entry: Entry): void {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = undefined;
    if (!userId || !entry.snapshot.hydrated) return;
    void options.save(userId, communityId, entry.snapshot).catch(() => {});
  }

  function entryFor(communityId: string): Entry {
    let entry = rooms.get(communityId);
    if (!entry) {
      entry = {
        snapshot: { messages: [], syncedThrough: null, hydrated: false, hasMore: true },
        listeners: new Set(), syncAgain: false, lastSyncAt: -Infinity,
      };
    }
    rooms.delete(communityId);
    rooms.set(communityId, entry);
    // Mounted rooms and outstanding reads are pinned; inactive windows are LRU.
    for (const [id, candidate] of rooms) {
      if (rooms.size <= (options.maxRooms ?? 40)) break;
      if (candidate === entry || candidate.listeners.size || candidate.sync || candidate.hydration) continue;
      flush(id, candidate);
      rooms.delete(id);
    }
    return entry;
  }

  function publish(communityId: string, entry: Entry, snapshot: CommunityMessageSnapshot, persist = true, source: 'hydrate' | 'sync' | 'live' = 'live') {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener(snapshot, source);
    if (persist && snapshot.hydrated && !entry.saveTimer) {
      entry.saveTimer = setTimeout(() => flush(communityId, entry), options.writeDelayMs ?? 500);
    }
  }

  async function hydrate(owner: string, communityId: string): Promise<void> {
    if (!active(owner)) return;
    const entry = entryFor(communityId);
    if (entry.snapshot.hydrated) return;
    if (entry.hydration) return entry.hydration;
    const generation = epoch;
    const pending = (async () => {
      const disk = await options.load(owner, communityId).catch(() => null);
      if (!active(owner, generation)) return;
      publish(communityId, entry, {
        messages: window(mergeMessagePage(disk?.messages ?? [], entry.snapshot.messages)),
        syncedThrough: disk?.syncedThrough ?? null,
        hydrated: true,
        hasMore: disk ? disk.messages.length >= PAGE_SIZE : true,
      }, entry.snapshot.messages.length > 0, 'hydrate');
    })().finally(() => { entry.hydration = undefined; });
    entry.hydration = pending;
    return pending;
  }

  function sync(owner: string, communityId: string, force = false): Promise<void> {
    if (!active(owner)) return Promise.resolve();
    const entry = entryFor(communityId);
    if (entry.sync) {
      if (force) entry.syncAgain = true;
      return entry.sync;
    }
    // A press-in and its screen mount share one read, including fast responses.
    if (!force && now() - entry.lastSyncAt < 1_000) return Promise.resolve();
    const generation = epoch;
    const pending = (async () => {
      await hydrate(owner, communityId);
      if (!active(owner, generation)) return;
      do {
        entry.syncAgain = false;
        const result = await drainCatchUpPages<Message>({
          from: entry.snapshot.syncedThrough,
          pageSize: PAGE_SIZE, maxPages: 20,
          fetchPage: (cursor) => options.fetchAfter(communityId, cursor),
          fetchLatestPage: () => options.fetchLatest(communityId, owner),
          isCancelled: () => !active(owner, generation),
          onPage: (page) => {
            const previous = entry.snapshot;
            const merged = window(enrichMessagePreviews(mergeMessagePage(previous.messages, page), page));
            publish(communityId, entry, {
              messages: merged,
              syncedThrough: latestMessageCursor(page) ?? previous.syncedThrough,
              hydrated: true,
              hasMore: previous.syncedThrough ? previous.hasMore : page.length >= PAGE_SIZE,
            }, true, 'sync');
            return page.filter((row) => !previous.messages.some((known) => known.id === row.id)).length;
          },
        });
        if (result.stoppedBy === 'error') throw result.error;
        if (!active(owner, generation)) return;
        // An empty latest page is also a useful local first paint.
        if (!entry.snapshot.syncedThrough && result.received === 0) {
          publish(communityId, entry, { ...entry.snapshot, hasMore: false });
        }
        entry.lastSyncAt = now();
        if (result.stoppedBy === 'max-pages') entry.syncAgain = true;
      } while (entry.syncAgain && active(owner, generation));
    })().finally(() => { entry.sync = undefined; });
    entry.sync = pending;
    return pending;
  }

  function remember(owner: string, communityId: string, rows: Message[]): void {
    if (!active(owner)) return;
    rows = rows.filter((row) => !row.id.startsWith('temp-'));
    if (!rows.length) return;
    const entry = entryFor(communityId);
    const merged = mergeMessagePage(entry.snapshot.messages, rows);
    if (merged !== entry.snapshot.messages) {
      publish(communityId, entry, { ...entry.snapshot, messages: window(merged) });
    }
    // Merge disk before persisting, even if the first arrival precedes navigation.
    void hydrate(owner, communityId);
  }

  function update(owner: string, communityId: string, transform: (rows: Message[]) => Message[]) {
    if (!active(owner)) return;
    const entry = entryFor(communityId);
    const apply = () => {
      const rows = transform(entry.snapshot.messages);
      if (rows.length === entry.snapshot.messages.length && rows.every((row, i) => row === entry.snapshot.messages[i])) return;
      publish(communityId, entry, { ...entry.snapshot, messages: window(rows) });
    };
    const generation = epoch;
    apply();
    if (!entry.snapshot.hydrated) {
      void hydrate(owner, communityId).then(() => { if (active(owner, generation)) apply(); });
    }
  }

  return {
    activateUser(next: string | null) {
      if (next === userId) return;
      for (const entry of rooms.values()) if (entry.saveTimer) clearTimeout(entry.saveTimer);
      rooms.clear();
      userId = next;
      epoch += 1;
    },
    peek(owner: string, communityId: string): CommunityMessageSnapshot | null {
      return active(owner) ? rooms.get(communityId)?.snapshot ?? null : null;
    },
    subscribe(owner: string, communityId: string, listener: Listener) {
      if (!active(owner)) return () => {};
      const entry = entryFor(communityId);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
    hydrate, sync, remember, update,
    flush() { for (const [id, entry] of rooms) flush(id, entry); },
  };
}
