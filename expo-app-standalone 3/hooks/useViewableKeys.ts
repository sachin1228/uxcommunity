import { useRef, useState } from 'react';
import type { ViewToken } from 'react-native';

/**
 * FlatList viewability → the set of item keys currently on screen. Cards use
 * it to autoplay only the video the member is looking at: scrolling past one
 * pauses it, so two soundtracks never overlap.
 *
 * 60% rather than the 50% a browser observer needs: a card tall enough to
 * carry a video can never share that much of the viewport with another one, so
 * at most a single video qualifies at a time.
 */
export function useViewableKeys() {
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(new Set());
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      setVisibleKeys(new Set(viewableItems.map((entry) => String(entry.key))));
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return { visibleKeys, onViewableItemsChanged, viewabilityConfig };
}
