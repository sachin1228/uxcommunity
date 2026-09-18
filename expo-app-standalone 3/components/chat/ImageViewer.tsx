import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmtDate, fmtTime } from '@/lib/chat';
import { saveImageToGallery } from '@/lib/deviceMedia';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

/** One image from the chat timeline, as shown inside the viewer. */
export interface LightboxImage {
  url: string;
  content: string | null;
  user_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface Props {
  images: LightboxImage[];
  /** Index of the currently viewed image inside `images`. */
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const SPRING = { damping: 20, stiffness: 200 };
const THUMB_SIZE = 56;
const THUMB_GAP = 8;

/**
 * Full-screen image lightbox — a React Native port of the web `ImageLightbox`:
 * sender header with timestamp, download and close actions, prev/next
 * navigation, the accompanying caption and a thumbnail strip of every image in
 * the chat. Pinch-zoom and double-tap-to-zoom are kept from the previous mobile
 * viewer (the web one is drag-and-keyboard only).
 */
export function ImageViewer({ images, index, onClose, onNavigate }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const stripRef = useRef<ScrollView>(null);
  const [saving, setSaving] = useState(false);

  const image = images[index];
  const total = images.length;

  // ── Zoom / pan state ────────────────────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset transforms whenever the viewed image changes.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetTransforms = useCallback(() => {
    'worklet';
    scale.value = withSpring(1, SPRING);
    savedScale.value = 1;
    translateX.value = withSpring(0, SPRING);
    translateY.value = withSpring(0, SPRING);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 6));
    })
    .onEnd(() => {
      if (scale.value <= 1) resetTransforms();
      else savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      if (scale.value <= 1) {
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

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

  const composed = Gesture.Simultaneous(Gesture.Simultaneous(pinch, pan), doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Keep the active thumbnail centred as the user navigates.
  useEffect(() => {
    if (total < 2) return;
    const x = index * (THUMB_SIZE + THUMB_GAP) - screenWidth / 2 + THUMB_SIZE / 2;
    stripRef.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [index, total, screenWidth]);

  const goPrev = useCallback(() => {
    if (index > 0) onNavigate(index - 1);
  }, [index, onNavigate]);

  const goNext = useCallback(() => {
    if (index < total - 1) onNavigate(index + 1);
  }, [index, total, onNavigate]);

  /**
   * Downloads the image into the app cache and saves it to the photo gallery,
   * mirroring the web lightbox's Download action.
   */
  const handleDownload = useCallback(async () => {
    if (!image || saving) return;
    setSaving(true);
    const result = await saveImageToGallery(image.url);
    setSaving(false);

    if (result.ok) return;
    Alert.alert(
      'Could not save image',
      result.reason === 'permission'
        ? 'Allow access to your photos to save chat images.'
        : 'Check your connection and try again.',
    );
  }, [image, saving]);

  const avatarUri = useMemo(
    () => resolveProfilePictureUri(image?.avatar_url ?? null),
    [image?.avatar_url],
  );

  if (!image) return null;

  const initials = (image.user_name ?? 'Unknown')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={[styles.root, { backgroundColor: LIGHTBOX_BG, paddingTop: insets.top }]}>
        {/* ── Header: sender info + actions ─────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
            </View>
            <View style={styles.headerText}>
              <Text numberOfLines={1} style={styles.userName}>
                {image.user_name ?? 'Unknown'}
              </Text>
              <Text style={styles.timestamp}>
                {fmtDate(image.created_at)} at {fmtTime(image.created_at)}
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              onPress={handleDownload}
              disabled={saving}
              hitSlop={6}
              accessibilityLabel="Save image to gallery"
              style={({ pressed }) => [styles.roundBtn, pressed && styles.roundBtnPressed]}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="download" size={18} color="#FFFFFF" />
              )}
            </Pressable>
            <Pressable
              onPress={onClose}
              hitSlop={6}
              accessibilityLabel="Close viewer"
              style={({ pressed }) => [styles.roundBtn, pressed && styles.roundBtnPressed]}
            >
              <Feather name="x" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>

        {/* ── Canvas: centred image + side navigation ───────────────────── */}
        <View style={styles.canvas}>
          {index > 0 && (
            <Pressable
              onPress={goPrev}
              hitSlop={6}
              accessibilityLabel="Previous image"
              style={[styles.navBtn, styles.navBtnLeft]}
            >
              <Feather name="chevron-left" size={22} color="#FFFFFF" />
            </Pressable>
          )}

          <GestureDetector gesture={composed}>
            <Animated.View style={[styles.imageWrapper, animatedStyle]}>
              <Image
                source={{ uri: image.url }}
                style={styles.image}
                contentFit="contain"
                transition={150}
              />
            </Animated.View>
          </GestureDetector>

          {index < total - 1 && (
            <Pressable
              onPress={goNext}
              hitSlop={6}
              accessibilityLabel="Next image"
              style={[styles.navBtn, styles.navBtnRight]}
            >
              <Feather name="chevron-right" size={22} color="#FFFFFF" />
            </Pressable>
          )}
        </View>

        {/* ── Caption (text that accompanied the image) ─────────────────── */}
        {!!image.content && (
          <View style={styles.captionWrap}>
            <Text style={styles.caption}>{image.content}</Text>
          </View>
        )}

        {/* ── Thumbnail strip — jump between every image in the chat ────── */}
        {total > 1 && (
          <View style={[styles.stripWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <ScrollView
              ref={stripRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.strip}
            >
              {images.map((img, i) => {
                const active = i === index;
                return (
                  <Pressable
                    key={`${img.url}-${i}`}
                    onPress={() => onNavigate(i)}
                    accessibilityLabel={`View image ${i + 1} of ${total}`}
                    style={[
                      styles.thumb,
                      {
                        borderColor: active ? colors.chatOwnBubble : 'rgba(255,255,255,0.15)',
                        opacity: active ? 1 : 0.7,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: img.url }}
                      style={styles.thumbImage}
                      contentFit="cover"
                      pointerEvents="none"
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

/** Web uses `#1e1e1e` for the lightbox canvas in both themes. */
const LIGHTBOX_BG = '#1E1E1E';

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 36, height: 36 },
  avatarInitials: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Geist_600SemiBold' },
  headerText: { flex: 1, minWidth: 0 },
  userName: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  timestamp: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontFamily: 'Geist_400Regular' },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },

  canvas: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  imageWrapper: { width: '100%', height: '100%' },
  image: { flex: 1, width: '100%' },

  navBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    zIndex: 5,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  navBtnLeft: { left: 16 },
  navBtnRight: { right: 16 },

  captionWrap: { paddingHorizontal: 24, paddingBottom: 8, alignItems: 'center' },
  caption: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },

  stripWrap: { paddingTop: 12 },
  strip: { paddingHorizontal: 16, gap: THUMB_GAP },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 6,
    borderWidth: 2,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
});
