import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Tactile feedback for gestures.
 *
 * Every call is fire-and-forget: a device with no haptic engine — or Android
 * hardware without a vibrator — rejects the promise, and a rejected haptic must
 * never break the gesture that asked for it. iOS honours the system Haptics
 * toggle on its own; Android exposes no equivalent setting to check.
 */
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** The long-press "peek" that announces a slide-over sheet. */
export function hapticImpact(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
): void {
  if (!supported) return;
  void Haptics.impactAsync(style).catch(() => {
    /* no haptic engine — silence is the right fallback */
  });
}
