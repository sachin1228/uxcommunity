import React, { useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * Full-screen playback for a showcase video.
 *
 * Cards and the detail page show the poster tile; tapping it opens this
 * player. The native player chrome (transport, scrubber, fullscreen) is used
 * as-is — it is the platform-standard control set, and the video plays the
 * moment it opens.
 */
export function VideoPlayerModal({
  url,
  poster,
  title,
  onClose,
}: {
  url: string;
  poster?: string | null;
  title?: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (instance) => {
    instance.play();
  });
  // The surface is black until it presents a frame; the poster stays over it
  // until `onFirstFrameRender`, so opening the player never flashes black.
  const coverOpacity = useRef(new Animated.Value(1)).current;
  const coverFirstFrame = () => {
    Animated.timing(coverOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          contentFit="contain"
          fullscreenOptions={{ enable: true }}
          useExoShutter={false}
          onFirstFrameRender={coverFirstFrame}
        />
        {poster ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: coverOpacity }]}
          >
            <Image
              source={{ uri: poster }}
              style={styles.cover}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          </Animated.View>
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={[styles.close, { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Close video"
        >
          <Feather name="x" size={22} color="#FFFFFF" />
        </Pressable>
        {title ? (
          <Text
            style={[styles.title, { bottom: Math.max(insets.bottom, 16) + 8 }]}
            numberOfLines={2}
          >
            {title}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  video: { flex: 1 },
  cover: { flex: 1, backgroundColor: '#000000' },
  close: {
    position: 'absolute',
    left: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  title: {
    position: 'absolute',
    left: 20,
    right: 20,
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.85)',
    textAlign: 'center',
  },
});
