import React, { forwardRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

export interface ChatScrollViewProps extends ScrollViewProps {
  bottomInset: SharedValue<number>;
  transition: SharedValue<number>;
  followThreshold: number;
}

/** iOS/web keep the screen's existing spacer-based keyboard avoidance. */
export const ChatScrollView = forwardRef<ScrollView, ChatScrollViewProps>(
  function ChatScrollView({ bottomInset, transition, followThreshold, ...props }, ref) {
    return <ScrollView {...props} ref={ref} />;
  },
);
