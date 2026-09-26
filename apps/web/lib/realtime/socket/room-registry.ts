import {
  createRoomState,
  invokeAll,
  type EventHandler,
  type PresenceHandler,
  type RealtimePresenceUser,
  type RoomState,
} from "./protocol";
import { isRoomIdle } from "./routing";

/**
 * Reference-counted room / topic / presence bookkeeping. Pure local state: the
 * client decides what to send over the wire based on the return values here.
 */
export class RoomRegistry {
  /** roomName → room subscription state */
  readonly rooms = new Map<string, RoomState>();
  private presenceCache = new Map<string, RealtimePresenceUser[]>();
  private globalPresenceHandlers = new Set<PresenceHandler>();

  /** `onRoomRemoved` runs after an idle or force-removed room is dropped. */
  constructor(private readonly onRoomRemoved: (room: string) => void) {}

  getOrCreate(room: string): RoomState {
    let state = this.rooms.get(room);
    if (!state) {
      state = createRoomState(room);
      this.rooms.set(room, state);
    }
    return state;
  }

  /** Adds a topic handler; returns whether it is the topic's first reference. */
  addTopicHandler(
    state: RoomState,
    topic: string,
    handler: EventHandler,
  ): { first: boolean; handlers: Set<EventHandler> } {
    const prev = state.topicRefs.get(topic) ?? 0;
    state.topicRefs.set(topic, prev + 1);
    let handlers = state.topicHandlers.get(topic);
    if (!handlers) {
      handlers = new Set();
      state.topicHandlers.set(topic, handlers);
    }
    handlers.add(handler);
    return { first: prev === 0, handlers };
  }

  /** Drops one topic reference; returns whether it was the last one. */
  removeTopicHandler(
    state: RoomState,
    handlers: Set<EventHandler>,
    topic: string,
    handler: EventHandler,
  ): boolean {
    handlers.delete(handler);
    const current = state.topicRefs.get(topic) ?? 0;
    if (current <= 1) {
      state.topicRefs.delete(topic);
      state.topicHandlers.delete(topic);
      return true;
    }
    state.topicRefs.set(topic, current - 1);
    return false;
  }

  cachedPresence(room: string): RealtimePresenceUser[] | undefined {
    return this.presenceCache.get(room);
  }

  setPresence(room: string, users: RealtimePresenceUser[]): void {
    this.presenceCache.set(room, users);
    invokeAll(this.rooms.get(room)?.presenceHandlers, [users], "presence handler");
    invokeAll(this.globalPresenceHandlers, [users], "global presence handler");
  }

  dispatch(room: string, topic: string, data: unknown, sender?: string): void {
    invokeAll(this.rooms.get(room)?.topicHandlers.get(topic), [data, sender], "event handler");
  }

  /** Remove a room if it has no active handlers and no subscribers. */
  removeIfIdle(room: string): void {
    const state = this.rooms.get(room);
    if (state && isRoomIdle(state)) this.drop(room);
  }

  /** Forcefully clear a room regardless of outstanding references. */
  forceRemove(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    state.topicRefs.clear();
    state.topicHandlers.clear();
    state.presenceHandlers.clear();
    state.subscribeRefs = 0;
    this.drop(room);
  }

  clear(): void {
    this.rooms.clear();
    this.presenceCache.clear();
    this.globalPresenceHandlers.clear();
  }

  private drop(room: string): void {
    this.rooms.delete(room);
    this.presenceCache.delete(room);
    this.onRoomRemoved(room);
  }
}
