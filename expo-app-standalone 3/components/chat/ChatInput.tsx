import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Message } from '@/lib/communities';

interface Props {
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (text: string) => void;
  onTypingChange: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ replyTo, onCancelReply, onSend, onTypingChange, disabled }: Props) {
  const colors = useColors();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  function handleChangeText(val: string) {
    setText(val);
    onTypingChange(val);
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    onTypingChange('');
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
      {/* Reply banner */}
      {replyTo && (
        <View style={[styles.replyBanner, { backgroundColor: colors.subtle, borderLeftColor: colors.primary }]}>
          <View style={styles.replyInfo}>
            <Text style={[styles.replyLabel, { color: colors.primary }]}>
              Replying to {replyTo.users?.name ?? 'message'}
            </Text>
            <Text style={[styles.replyPreview, { color: colors.mutedForeground }]} numberOfLines={1}>
              {replyTo.content ?? '📷 Image'}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            {
              backgroundColor: colors.subtle,
              borderColor: colors.border,
              color: colors.foreground,
            },
          ]}
          placeholder="Message…"
          placeholderTextColor={colors.mutedForeground}
          value={text}
          onChangeText={handleChangeText}
          multiline
          maxLength={2000}
          returnKeyType="default"
          editable={!disabled}
        />

        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || disabled}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor:
                !text.trim() || disabled
                  ? colors.subtle
                  : pressed
                    ? colors.primaryHover
                    : colors.primary,
            },
          ]}
        >
          <Feather
            name="send"
            size={18}
            color={!text.trim() || disabled ? colors.mutedForeground : colors.primaryForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 8,
  },
  replyInfo: {
    flex: 1,
    gap: 2,
  },
  replyLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  replyPreview: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
