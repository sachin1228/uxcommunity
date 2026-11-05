import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { cachedLottie, emojiToCodepoint, loadLottie } from '@/lib/notoEmoji';
import { NotoEmojiSvg } from './NotoEmojiSvg';

interface Props {
  emoji: string;
  size?: number;
  /**
   * Fetch and play only while the containing chat row is on screen (the
   * mobile equivalent of the web IntersectionObserver). Offscreen emoji keep
   * their static SVG and never download animation data.
   */
  play?: boolean;
}

/**
 * Animated Noto emoji — the React Native counterpart of the web
 * `AnimatedEmoji`. The still SVG renders until the Lottie JSON arrives, then
 * the animation replaces it; offscreen instances stay static.
 */
export const AnimatedEmoji = memo(function AnimatedEmoji({
  emoji,
  size = 20,
  play = true,
}: Props) {
  const codepoint = useMemo(() => emojiToCodepoint(emoji), [emoji]);
  const [animation, setAnimation] = useState<AnimationObject | null>(
    () => (codepoint ? (cachedLottie(codepoint) as AnimationObject | null) : null),
  );
  const [failed, setFailed] = useState(false);
  const player = useRef<LottieView>(null);

  useEffect(() => {
    if (!codepoint || animation || failed || !play) return;
    let cancelled = false;
    loadLottie(codepoint).then((json) => {
      if (cancelled) return;
      if (json) setAnimation(json as AnimationObject);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [codepoint, animation, failed, play]);

  useEffect(() => {
    if (!animation) return;
    if (play) player.current?.play();
    else player.current?.pause();
  }, [animation, play]);

  if (animation) {
    return (
      <LottieView
        ref={player}
        source={animation}
        autoPlay={play}
        loop
        style={{ width: size, height: size, marginHorizontal: 1 }}
      />
    );
  }

  return <NotoEmojiSvg emoji={emoji} size={size} />;
});
