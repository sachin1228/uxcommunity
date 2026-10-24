import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { ViewToken } from 'react-native';

/**
 * FlatList viewability → the set of item keys currently on screen. Cards use
 * it to autoplay only the video the member is looking at: scrolling past one
 * pauses it, so two soundtracks never overlap.
 *
 * The set lives in a tiny external store instead of `useState` on the screen.
 * The old state version re-rendered the whole feed (and recreated `renderItem`,
 * so every mounted card re-rendered too) on every scroll settle. Here each
 * card subscribes to its own key and only the cards whose visibility actually
 * changed re-render.
 *
 * 60% rather than the 50% a browser observer needs: a card tall enough to
 * carry a video can never share that much of the viewport with another one, so
 * at most a single video qualifies at a time.
 */
export interface ViewableKeyStore {
  isViewable(key: string): boolean;
  subscribe(key: string, listener: () => void): () => void;
}

type Listener = () => void;

function createViewableKeyStore(): ViewableKeyStore & {
  setViewableKeys(keys: ReadonlySet<string>): void;
} {
  let visibleKeys: ReadonlySet<string> = new Set();
  const listeners = new Map<string, Set<Listener>>();

  return {
    isViewable(key) {
      return visibleKeys.has(key);
    },
    subscribe(key, listener) {
      let keyListeners = listeners.get(key);
      if (!keyListeners) {
        keyListeners = new Set();
        listeners.set(key, keyListeners);
      }
      keyListeners.add(listener);
      return () => {
        keyListeners?.delete(listener);
        if (keyListeners?.size === 0) listeners.delete(key);
      };
    },
    setViewableKeys(next) {
      if (next === visibleKeys) return;
      const changed: string[] = [];
      for (const key of visibleKeys) if (!next.has(key)) changed.push(key);
      for (const key of next) if (!visibleKeys.has(key)) changed.push(key);
      visibleKeys = next;
      for (const key of changed) {
        const keyListeners = listeners.get(key);
        if (!keyListeners) continue;
        for (const listener of keyListeners) listener();
      }
    },
  };
}

export function useViewableKeys() {
  const storeRef = useRef<ReturnType<typeof createViewableKeyStore> | null>(null);
  if (!storeRef.current) storeRef.current = createViewableKeyStore();
  const store = storeRef.current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      store.setViewableKeys(new Set(viewableItems.map((entry) => String(entry.key))));
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return { viewableStore: store as ViewableKeyStore, onViewableItemsChanged, viewabilityConfig };
}

/**
 * Subscribe one card to its own key. `getSnapshot` is a boolean, so React only
 * re-renders the card when this key enters or leaves the viewable set — not
 * when any other card does.
 */
export function useIsViewable(store: ViewableKeyStore, key: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [key, store],
  );
  const getSnapshot = useCallback(() => store.isViewable(key), [key, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
