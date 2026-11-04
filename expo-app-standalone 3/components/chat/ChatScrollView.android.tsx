import React, { forwardRef, useCallback } from 'react';
import { type HostComponent, type ScrollView, StyleSheet, type ViewProps } from 'react-native';
import { ClippingScrollView } from 'react-native-keyboard-controller';
import Animated, {
  runOnUI,
  scrollTo,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
} from 'react-native-reanimated';
import type { ChatScrollViewProps } from './ChatScrollView';

// keyboard-controller's public binding omits the decorator's native inset
// props from its TS type. These match its generated native component spec.
const InsetView = Animated.createAnimatedComponent(
  ClippingScrollView as unknown as HostComponent<ViewProps & {
    contentInsetTop: number;
    contentInsetBottom: number;
  }>,
);

/**
 * Keep an inverted chat list's viewport fixed while its dock moves.
 * The native decorator extends the scroll range and preserves the visible
 * content when the inset changes. Only a reader already at the newest rows
 * follows the dock. One shared inset owns keyboard AND emoji-panel handoffs.
 *
 * Based on keyboard-controller's layout-free chat approach:
 * https://kirillzyusko.github.io/react-native-keyboard-controller/blog/chat-scroll-view
 */
export const ChatScrollView = forwardRef<ScrollView, ChatScrollViewProps>(
  function ChatScrollView({
    bottomInset,
    transition,
    followThreshold,
    onScrollBeginDrag,
    onScrollEndDrag,
    ...props
  }, forwardedRef) {
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const offset = useScrollOffset(scrollRef);
    const follow = useSharedValue(true);
    const dragging = useSharedValue(false);

    const setRef = useCallback((node: Animated.ScrollView | null) => {
      scrollRef(node);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef, scrollRef]);

    const animatedProps = useAnimatedProps(() => ({
      contentInsetTop: bottomInset.value,
      contentInsetBottom: 0,
    }));

    useAnimatedReaction(
      () => ({ inset: bottomInset.value, transition: transition.value }),
      (current, previous) => {
        // Snapshot before the first inset frame; synthetic native scroll
        // events during an animation must not change the decision mid-flight.
        if (!previous || current.transition !== previous.transition) {
          follow.value = !dragging.value && offset.value <= followThreshold;
        }
        if (previous && current.inset === previous.inset) return;
        if (!follow.value) return;

        // Apply the native inset first, then scroll. Otherwise Android can
        // clamp the command against the old range. Never queue smooth scrolls
        // alongside the IME's own animation.
        requestAnimationFrame(() => {
          if (scrollRef() && follow.value && !dragging.value && transition.value === current.transition) {
            scrollTo(scrollRef, 0, 0, false);
          }
        });
      },
      [followThreshold],
    );

    const beginDrag = useCallback(() => {
      'worklet';
      dragging.value = true;
      follow.value = false;
    }, [dragging, follow]);
    const endDrag = useCallback(() => {
      'worklet';
      dragging.value = false;
    }, [dragging]);

    return (
      <InsetView style={styles.container} contentInsetTop={0} contentInsetBottom={0} animatedProps={animatedProps}>
        <Animated.ScrollView
          {...props}
          ref={setRef}
          onScrollBeginDrag={(event) => {
            runOnUI(beginDrag)();
            onScrollBeginDrag?.(event);
          }}
          onScrollEndDrag={(event) => {
            runOnUI(endDrag)();
            onScrollEndDrag?.(event);
          }}
        />
      </InsetView>
    );
  },
);

const styles = StyleSheet.create({ container: { flex: 1 } });
