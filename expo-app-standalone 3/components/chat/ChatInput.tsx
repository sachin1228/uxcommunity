import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Message } from '@/lib/communities';
import * as ImagePicker from 'expo-image-picker';

export interface PendingImage {
  uri: string;
  mimeType: string;
}

interface Props {
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (text: string, pendingImage?: PendingImage) => void;
  onTypingChange: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ replyTo, onCancelReply, onSend, onTypingChange, disabled }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const inputRef = useRef<TextInput>(null);

  function handleChangeText(val: string) {
    setText(val);
    onTypingChange(val);
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed && !pendingImage) return;
    onSend(trimmed, pendingImage ?? undefined);
    setText('');
    setPendingImage(null);
    onTypingChange('');
  }

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setPendingImage({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
  }

  const canSend = (!!text.trim() || !!pendingImage) && !disabled;

  const bottomPadding = Platform.OS === 'ios' ? Math.max(insets.bottom, 8) : 8;

  return (
    <View style={[styles.root, { paddingBottom: bottomPadding }]}>
      {/* Reply banner */}
      {replyTo && (
        <View style={[styles.replyBanner, { backgroundColor: colors.subtle, borderLeftColor: colors.primary }]}>
          <View style={styles.replyInfo}>
            <Text style={[styles.replyLabel, { color: colors.primary }]}>
              Replying to {replyTo.users?.name ?? 'message'}
            </Text>
            <Text style={[styles.replyText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {replyTo.content ?? '📷 Image'}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {/* Pending image preview strip */}
      {pendingImage && (
        <View style={[styles.imageBanner, { backgroundColor: colors.subtle, borderColor: colors.border }]}>
          <Image source={{ uri: pendingImage.uri }} style={styles.imageThumb} resizeMode="cover" />
          <Text style={[styles.imageReady, { color: colors.mutedForeground }]}>
            Image ready to send
          </Text>
          <Pressable onPress={() => setPendingImage(null)} hitSlop={8}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {/* Input row: [ pill: 😊 text 📎 ] [ ▶ send ] */}
      <View style={styles.inputRow}>

        {/* Floating pill: emoji left | text | image right */}
        <View style={[styles.pill, { backgroundColor: colors.card }]}>
          {/* Emoji button — left inside pill */}
          <Pressable
            hitSlop={6}
            style={({ pressed }) => [styles.pillBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="smile" size={20} color={colors.mutedForeground} />
          </Pressable>

          {/* Text input */}
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { color: colors.foreground }]}
            placeholder="Message…"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={handleChangeText}
            multiline
            maxLength={2000}
            returnKeyType="default"
            editable={!disabled}
            // Android: keep text anchored to the top so multiline grows naturally
            textAlignVertical="top"
          />

          {/* Image picker button — right inside pill */}
          <Pressable
            onPress={handlePickImage}
            disabled={disabled}
            hitSlop={6}
            style={({ pressed }) => [styles.pillBtn, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather
              name="paperclip"
              size={20}
              color={pendingImage ? colors.primary : colors.mutedForeground}
            />
          </Pressable>
        </View>

        {/* Send button — outside the pill, to the right */}
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: canSend
                ? pressed ? colors.primaryHover : colors.primary
                : colors.subtle,
            },
          ]}
        >
          {disabled ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name="send"
              size={18}
              color={canSend ? colors.primaryForeground : colors.mutedForeground}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },

  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 8,
  },
  replyInfo: { flex: 1, gap: 2 },
  replyLabel: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  replyText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

  imageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  imageThumb: { width: 48, height: 48, borderRadius: 8, flexShrink: 0 },
  imageReady: { flex: 1, fontSize: 12, fontFamily: 'Geist_400Regular' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },

  // Floating pill — emoji | text | image
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },

  // Icon buttons inside the pill
  pillBtn: {
    width: 36,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  textInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Geist_400Regular',
    maxHeight: 120,
    lineHeight: 20,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: 'transparent',
    includeFontPadding: false,
  },

  // Send button — outside the pill
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
