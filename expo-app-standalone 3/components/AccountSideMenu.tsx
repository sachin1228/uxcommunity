import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountMenuContent } from '@/components/AccountMenuContent';
import { useColors } from '@/hooks/useColors';

/**
 * The account menu as a side menu — the Profile header's hamburger slides it
 * in from the right edge: full height, roughly half the screen wide, in the
 * page's own black with quietly rounded left corners, and a scrim behind it
 * that closes it on tap (the usual hamburger drawer).
 *
 * The rows are the shared AccountMenuContent — Settings and Sign out — so they
 * match the avatar's bottom sheet row for row.
 */

const PANEL_WIDTH_RATIO = 0.62;
const PANEL_MAX_WIDTH = 320;
const SLIDE_DURATION = 240;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountSideMenu({ open, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(Math.round(width * PANEL_WIDTH_RATIO), PANEL_MAX_WIDTH);

  // `mounted` keeps the Modal around for the exit slide; `progress` drives the
  // slide and the scrim's fade (0 closed → 1 open).
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: SLIDE_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: SLIDE_DURATION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, progress]);

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Scrim — tap beside the panel to close, exactly like the sheet's. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            style={[StyleSheet.absoluteFill, styles.scrim]}
            onPress={onClose}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              // The page's own black rather than a raised surface — the panel
              // reads as the page sliding over, not a card on top of it.
              backgroundColor: colors.background,
              borderLeftColor: colors.border,
              // Starts below the status bar (and the Dynamic Island) like any
              // other sidebar — the top inset is the panel's top edge, not
              // padding, so the rows are not pushed further down.
              top: insets.top,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
              shadowColor: '#000',
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [panelWidth, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <AccountMenuContent onNavigate={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    // A little rounding along the leading edge, so the panel reads as a
    // sheet rather than a second screen split down the middle.
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    overflow: 'hidden',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: -6, height: 0 },
    elevation: 16,
  },
});
