import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createChatScrollIndicatorGate,
  type ChatScrollIndicatorGate,
} from '@/lib/chatScrollIndicator';

/**
 * Keeps the chat scrollbar out of the mount animation (see
 * lib/chatScrollIndicator for why it would otherwise start almost full length
 * and shrink on every render batch).
 *
 * Spread the result onto the chat FlatList:
 *
 *   <FlatList {...chatScrollIndicator} … />
 *
 * The bar is off until the content height has held still, then it stays on for
 * the life of the screen — pagination, edits and new messages never hide it.
 */
export function useChatScrollIndicator() {
  const [ready, setReady] = useState(false);
  const gateRef = useRef<ChatScrollIndicatorGate | null>(null);
  if (gateRef.current === null) {
    gateRef.current = createChatScrollIndicatorGate({
      onReveal: () => setReady(true),
    });
  }

  // A pending reveal must not set state on an unmounted screen.
  useEffect(() => {
    const gate = gateRef.current;
    return () => gate?.dispose();
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    gateRef.current?.measure(height);
  }, []);

  return {
    showsVerticalScrollIndicator: ready,
    onContentSizeChange,
  };
}
