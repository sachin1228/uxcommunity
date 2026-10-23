import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';

/**
 * How long a native push takes, plus a frame of slack. Android never reports
 * the end of one: react-native-screens only emits its appear callback on iOS,
 * where native-stack turns it into `transitionEnd`. The timer is the only
 * signal on Android.
 */
const SETTLE_FALLBACK_MS = 340;

/** The slice of native-stack's event map this hook listens to. */
type TransitionEndEvent = { data?: { closing?: boolean } };
type TransitionListener = (
  type: 'transitionEnd',
  listener: (event: TransitionEndEvent) => void,
) => () => void;

/**
 * True once the stack transition that opened this screen is over.
 *
 * The chat screens mount a FlatList of variable-height bubbles. Creating those
 * native views while the native slide is running starves the transition: the
 * animation visibly stops for a frame or two, then jumps to the end. Holding
 * the list back until the transition settles moves that work after the
 * animation, where a busy frame is invisible.
 *
 * iOS reports the exact end through native-stack's `transitionEnd`; elsewhere
 * the bounded fallback stands in, which also covers a push that does not
 * animate at all. Both paths are one-shot, and the timer is scheduled whatever
 * the event does, so a navigator without the event can never hold the screen
 * on its loading state.
 */
export function useScreenTransitionSettled(): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (settled) return undefined;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setSettled(true);
    };

    // expo-router types `useNavigation` for the generic event map, which does
    // not carry the native-stack events; the listener is narrowed here.
    const addListener = (navigation as unknown as { addListener?: TransitionListener })
      .addListener;
    let unsubscribe: (() => void) | undefined;
    if (typeof addListener === 'function') {
      try {
        unsubscribe = addListener.call(navigation, 'transitionEnd', (event) => {
          // `closing` is this screen being popped, not the mount to wait for.
          if (!event?.data?.closing) finish();
        });
      } catch {
        // A navigator without the event falls through to the timer below.
        unsubscribe = undefined;
      }
    }

    const timer = setTimeout(finish, SETTLE_FALLBACK_MS);

    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [navigation, settled]);

  return settled;
}
