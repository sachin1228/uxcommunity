/**
 * The in-app mirror for content items the current user just created or
 * deleted from the community tabs — the React Native port of the web
 * cache/content-mirror.ts channel.
 *
 * WHY THIS EXISTS
 *   When the user creates a thread/showcase post/resource/event from its tab,
 *   the mounted chat timeline (hooks/useChatContentEvents) has to add its
 *   permanent "You created a …" card in the same frame — without waiting for
 *   the realtime round trip, and without the two views knowing about each
 *   other. This is that channel, and its payload mirrors the realtime
 *   content-insert / content-delete topics so the timeline treats both paths
 *   identically (idempotent by item id).
 *
 *   It is not cache state: it is a notification of a mutation.
 */

import type { ChatContentEvent, ChatContentKind } from './chatContentEvents';
import { patchCachedBootstrapContentEvents } from './communityBootstrap';

export type ContentEventChange =
  | { kind: 'insert'; communityId: string; event: ChatContentEvent }
  | { kind: 'delete'; communityId: string; id: string; contentKind: ChatContentKind };

type Listener = (change: ContentEventChange) => void;

const listeners = new Set<Listener>();

/** Announce a local create/delete to the timeline. */
export function notifyContentEvent(change: ContentEventChange): void {
  // The chat screen is often unmounted when this fires (the content was
  // created from another tab), so keep the cached chat snapshot in step too —
  // otherwise switching to Chat inside the bootstrap window misses the card.
  patchCachedBootstrapContentEvents(
    change.communityId,
    change.kind === 'insert'
      ? { kind: 'insert', event: change.event }
      : { kind: 'delete', id: change.id },
  );
  for (const listener of listeners) listener(change);
}

/** Subscribe to local creates/deletes; returns the unsubscribe. */
export function subscribeContentEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
