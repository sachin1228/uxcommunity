import { useCallback, useSyncExternalStore } from 'react';
import type { MessageVisibilityStore } from '@/lib/messageVisibility';

/**
 * Whether a chat row is on screen. Without a gating store (e.g. a bubble
 * rendered outside a chat list) everything is treated as visible.
 */
export function useMessageVisibility(
  store: MessageVisibilityStore | undefined,
  messageId: string,
): boolean {
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
    [store],
  );
  const getSnapshot = useCallback(
    () => (store ? store.isVisible(messageId) : true),
    [store, messageId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
