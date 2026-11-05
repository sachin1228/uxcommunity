/**
 * Which chat rows are on screen — the mobile stand-in for the web
 * AnimatedEmoji's IntersectionObserver.
 *
 * The chat FlatLists report their viewable rows into one store; emoji inside
 * a row subscribe to it and only fetch/play their Lottie while that row is
 * visible. Scroll updates therefore re-render only the emoji whose visibility
 * actually flipped, not the list.
 */

export interface MessageVisibilityStore {
  isVisible(messageId: string): boolean;
  setVisible(messageIds: ReadonlySet<string>): void;
  subscribe(listener: () => void): () => void;
}

export function createMessageVisibilityStore(): MessageVisibilityStore {
  let visible = new Set<string>();
  const listeners = new Set<() => void>();

  return {
    isVisible(messageId) {
      return visible.has(messageId);
    },
    setVisible(messageIds) {
      if (
        messageIds.size === visible.size &&
        [...messageIds].every((id) => visible.has(id))
      ) {
        return;
      }
      visible = new Set(messageIds);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
