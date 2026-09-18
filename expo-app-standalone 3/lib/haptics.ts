import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Tactile feedback for the app's touch affordances.
 *
 * One vocabulary, two engines: iOS gets the `UIFeedbackGenerator` styles, while
 * Android gets the platform's own haptics constants — which is why the platform
 * branch lives down here instead of at every call site. Every call is
 * fire-and-forget, because a device with no haptic engine rejects the promise
 * and a haptic is never worth taking a gesture down for.
 *
 * iOS honours the system Haptics toggle on its own; Android exposes no
 * equivalent setting to check.
 */
const onIOS = Platform.OS === 'ios';
const supported = onIOS || Platform.OS === 'android';

function play(call: () => Promise<void>): void {
  if (!supported) return;
  try {
    void call().catch(() => {
      /* no haptic engine — silence is the right fallback */
    });
  } catch {
    /* a synchronously missing native module must not break the gesture */
  }
}

/** A long press that opens a sheet: the "peek" weight. */
export function hapticImpact(): void {
  play(() =>
    onIOS
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      : Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press),
  );
}

/** Moving between choices: a menu row, a sort chip, a selected option. */
export function hapticSelection(): void {
  play(() =>
    onIOS
      ? Haptics.selectionAsync()
      : Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick),
  );
}

/** A switch flipped: liked → unliked, reacted → not reacted. */
export function hapticToggle(active: boolean): void {
  play(() =>
    onIOS
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.performAndroidHapticsAsync(
          active ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off,
        ),
  );
}

/** A write landed — a comment posted, a delete confirmed. */
export function hapticSuccess(): void {
  play(() =>
    onIOS
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm),
  );
}

/** A write failed — the rollback deserves a weight of its own. */
export function hapticError(): void {
  play(() =>
    onIOS
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      : Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject),
  );
}
