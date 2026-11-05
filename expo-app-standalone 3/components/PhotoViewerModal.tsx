import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarBackground, nameInitials } from '@/lib/avatar';
import { mediaCachePolicy, mediaSource } from '@/lib/privateMedia';

interface Props {
  visible: boolean;
  /** The photo itself. Empty renders the enlarged initials instead. */
  uri: string | null;
  /** The bar's title — "Profile picture" / "Community photo". */
  title?: string;
  /**
   * The member the picture belongs to. Supplying it lets the viewer open with
   * initials when there is no photo yet (your own profile), so the header's
   * edit action is still the way to set one.
   */
  name?: string;
  /**
   * The owner's own picture only: opens the change-photo flow. The pencil
   * lives here rather than over the avatar, the way a chat app's full-screen
   * profile photo works — viewing first, editing from inside.
   */
  onEdit?: () => void;
  onClose: () => void;
}

/**
 * The full-screen display-picture viewer: the photo alone, centred on a black
 * canvas, with the title and a way back above it. A click on a community's
 * face or a member's picture opens it; on the owner's own picture the pencil
 * in the bar is the way to change it. With no picture yet it shows the same
 * initials the profile does, enlarged, so the pencil is still one tap away.
 */
export function PhotoViewerModal({
  visible,
  uri,
  title = 'Profile picture',
  name,
  onEdit,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const fallbackSize = Math.min(260, Math.round(width * 0.58));

  return (
    <Modal
      visible={visible && Boolean(uri || name)}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar style="light" />
      <View
        style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.bar}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.barBtn, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.actions}>
            {onEdit ? (
              <Pressable
                onPress={onEdit}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
                style={({ pressed }) => [styles.barBtn, pressed && styles.pressed]}
              >
                <Feather name="edit-2" size={19} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.canvas}>
          {uri ? (
            <Image
              source={mediaSource(uri)}
              style={styles.image}
              contentFit="contain"
              transition={120}
              cachePolicy={mediaCachePolicy(uri)}
              accessibilityLabel={title}
            />
          ) : (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${name ?? 'Your'} profile picture placeholder`}
              style={[
                styles.fallback,
                {
                  width: fallbackSize,
                  height: fallbackSize,
                  borderRadius: fallbackSize / 2,
                  backgroundColor: avatarBackground(name),
                },
              ]}
            >
              <Text
                style={[styles.fallbackText, { fontSize: Math.round(fallbackSize * 0.38) }]}
              >
                {nameInitials(name)}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // A photo viewer is black in either theme — the photo is the only colour.
  root: { flex: 1, backgroundColor: '#000000' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  barBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  title: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontFamily: 'Geist_500Medium',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  canvas: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fallbackText: { color: '#FFFFFF', fontFamily: 'Geist_600SemiBold' },
});
