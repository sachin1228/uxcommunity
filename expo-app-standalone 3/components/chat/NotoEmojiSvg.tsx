import React, { memo, useState } from 'react';
import { Text } from 'react-native';
import { Image } from 'expo-image';
import { emojiToCodepoint, svgUrlForCodepoint } from '@/lib/notoEmoji';

interface Props {
  emoji: string;
  size?: number;
}

/**
 * Static Noto emoji — the React Native counterpart of the web
 * `NotoEmojiSvg`. Used by the emoji picker and as the still frame while an
 * animated emoji's Lottie JSON is not loaded.
 */
export const NotoEmojiSvg = memo(function NotoEmojiSvg({ emoji, size = 22 }: Props) {
  const codepoint = emojiToCodepoint(emoji);
  const [failed, setFailed] = useState(false);

  // No asset for this sequence (or the SVG fetch failed): use the system
  // glyph rather than leaving a hole in the message.
  if (!codepoint || failed) {
    return (
      <Text style={{ fontSize: size * 0.8, lineHeight: size }}>{emoji}</Text>
    );
  }

  return (
    <Image
      source={{ uri: svgUrlForCodepoint(codepoint) }}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="memory-disk"
      accessibilityLabel={emoji}
      onError={() => setFailed(true)}
    />
  );
});
