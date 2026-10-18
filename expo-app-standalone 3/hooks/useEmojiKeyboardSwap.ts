import { useEffect, useRef } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * How long a touch on the field waits for the IME before the panel steps aside
 * on its own. `keyboardWillShow` lands within a frame or two of the tap, so the
 * timer only ever fires when the tap failed to raise the keyboard at all —
 * without it the panel would sit there covering a composer the user meant to
 * type in.
 */
const HANDOFF_TIMEOUT_MS = 400;

/**
 * Makes the composer's emoji panel and the keyboard trade places in a single
 * move, the way WhatsApp does it.
 *
 * The chat screen pads its content by the keyboard's height, and the panel
 * claims that same space. So if the panel closes at the very moment the IME
 * reports in, the 320-odd dp the panel gave up is the 320-odd dp the keyboard
 * inset takes — the composer above them does not move. Collapsing the panel
 * earlier (on touch-down, or on focus) leaves a gap where neither occupies the
 * bottom: the composer drops, then rides back up with the keyboard, which reads
 * as the flicker this hook exists to remove.
 *
 * @param open    whether the panel is currently open
 * @param setOpen closes (or opens) it
 */
export function useEmojiKeyboardSwap(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  /** Height the IME last took on this screen — the panel borrows it. */
  const heightRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const subscription = Keyboard.addListener(
      // iOS announces the IME before it animates, which is when the panel has
      // to go; Android only reports once it is up.
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event: KeyboardEvent) => {
        heightRef.current = event.endCoordinates.height;
        clearTimer();
        if (openRef.current) setOpenRef.current(false);
      },
    );

    return () => {
      clearTimer();
      subscription.remove();
    };
  }, []);

  /**
   * The user asked for the keyboard (touched the field, or tapped the keyboard
   * glyph) while the panel is open. The panel is *not* collapsed here — it
   * waits for the IME's own announcement a few milliseconds later, so the swap
   * is one continuous motion instead of a collapse followed by a rise.
   *
   * Callers still focus the field themselves; this only arms the fallback.
   */
  const startHandoff = () => {
    if (!openRef.current) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (openRef.current) setOpenRef.current(false);
    }, HANDOFF_TIMEOUT_MS);
  };

  return {
    /**
     * The IME's height (0 until it has been seen). Read at render time, so the
     * panel opens at the size the keyboard will take when it comes back.
     */
    keyboardHeight: heightRef.current,
    startHandoff,
  };
}
