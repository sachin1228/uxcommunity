import { useEffect, useRef } from 'react';
import { KeyboardEvents } from 'react-native-keyboard-controller';

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
 * The chat screen reserves the keyboard's height while the IME is up, and the
 * panel claims that same height. So if the panel goes at the instant the IME
 * starts to rise, the space it gives up is the space the IME takes in the same
 * frames — the composer above them does not move, and the two never share the
 * screen.
 *
 * Both halves of that matter, and both depend on *which* event is used:
 *
 *  - Closing earlier (on touch-down, before the IME even starts) drops the
 *    composer to the bottom and brings it back up with the keyboard — a visible
 *    dip.
 *  - Closing later (`keyboardDidShow`, the only will-event React Native's own
 *    `Keyboard` module has on Android) leaves the panel on screen for the whole
 *    IME animation — the flash of "both panels".
 *
 * `react-native-keyboard-controller` announces `keyboardWillShow` on both
 * platforms by watching the IME inset animation itself, which is exactly the
 * frame this needs. It is available because `KeyboardProvider` wraps the app.
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

    const subscription = KeyboardEvents.addListener('keyboardWillShow', (event) => {
      heightRef.current = event.height;
      clearTimer();
      // The IME is on its way up: the panel yields the space it was holding so
      // the two hand over without either the composer or the list moving.
      if (openRef.current) setOpenRef.current(false);
    });

    return () => {
      clearTimer();
      subscription.remove();
    };
  }, []);

  /**
   * The user asked for the keyboard (touched the field, or tapped the keyboard
   * glyph) while the panel is open. The panel is *not* collapsed here — it
   * waits for the IME's own announcement a few milliseconds later, so the swap
   * is one continuous motion. This only arms the fallback for a tap that never
   * raises the keyboard.
   *
   * Callers still focus the field themselves.
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
