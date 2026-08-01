import React, { useCallback, useEffect } from 'react';
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

interface Props {
  uri: string | null;
  onClose: () => void;
}

const SPRING = { damping: 20, stiffness: 200 };

export function ImageViewer({ uri, onClose }: Props) {
  // ── Zoom / pan state ────────────────────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset transforms every time a new image is opened.
  useEffect(() => {
    if (uri) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
    }
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetTransforms = useCallback(() => {
    'worklet';
    scale.value = withSpring(1, SPRING);
    savedScale.value = 1;
    translateX.value = withSpring(0, SPRING);
    translateY.value = withSpring(0, SPRING);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gestures ────────────────────────────────────────────────────────────────

  /** Pinch to zoom in/out. Snaps back to 1× if released below minimum. */
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(0.5, Math.min(savedScale.value * e.scale, 6));
    })
    .onEnd(() => {
      if (scale.value < 1) {
        resetTransforms();
      } else {
        savedScale.value = scale.value;
      }
    });

  /** Pan to move around while zoomed. */
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      // Snap back to centre when not zoomed
      if (scale.value <= 1) {
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  /** Double-tap: zoom in to 2.5× or reset to 1×. */
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      if (scale.value > 1) {
        resetTransforms();
      } else {
        scale.value = withSpring(2.5, SPRING);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(
    Gesture.Simultaneous(pinch, pan),
    doubleTap
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!uri) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar hidden />

      <View style={styles.backdrop}>
        {/* Close button ───────────────────────────────────────────────────── */}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={styles.closeBtn}
          accessibilityLabel="Close image"
          accessibilityRole="button"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>

        {/* Zoomable image ─────────────────────────────────────────────────── */}
        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.imageWrapper, animatedStyle]}>
            <Image
              source={{ uri }}
              style={styles.image}
              contentFit="contain"
              transition={200}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '600',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
  },
  image: {
    flex: 1,
    width: '100%',
  },
});
