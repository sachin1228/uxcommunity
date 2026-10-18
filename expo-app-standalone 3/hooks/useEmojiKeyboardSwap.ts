import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardEvents,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Panel height before the IME has ever been measured on this screen. */
const DEFAULT_PANEL_HEIGHT = 320;

/** The shortest a panel may get, however tall the keyboard is. */
const MIN_PANEL_HEIGHT = 160;

/**
 * The composer's own bottom padding while the panel is shut (dp). It is part of
 * the panel's height so that the composer sits in exactly the same place with
 * the panel open as it does with the keyboard up: the keyboard state keeps that
 * padding, the panel state trades it for the panel.
 */
export const COMPOSER_BOTTOM_INSET = 8;

/**
 * How long a touch on the field waits for the IME before the panel steps aside
 * on its own. `keyboardWillShow` lands within a frame or two of the tap, so the
 * timer only ever fires when the tap failed to raise the keyboard at all —
 * without it the panel would sit there covering a composer the user meant to
 * type in.
 */
const HANDOFF_TIMEOUT_MS = 400;

/** Duration of the panel's own open/close animation, when no IME is involved. */
const PANEL_TRANSITION_MS = 200;

/**
 * Makes the composer's emoji panel and the keyboard trade places in a single
 * move, the way WhatsApp does it.
 *
 * The panel and the IME occupy the same strip of screen, and the chat screen
 * reserves whatever the IME takes. So the panel is not given a fixed height
 * that appears and disappears — its *space* is the IME's complement:
 *
 *     panelHeight = (1 - keyboardProgress) * keyboardHeight
 *
 * While the IME is anywhere on its way up or down, that expression is a smooth
 * function of the keyboard's own animation, so the two always add up to exactly
 * one keyboard height: opening the panel over a keyboard hands it the space the
 * IME gives back (the composer between them never moves), and closing it back
 * to the keyboard takes that space away at the same rate the IME reclaims it.
 * Neither the composer nor the list moves by a pixel, and the two never share
 * the screen — no "both panels" flash and no dip in between.
 *
 * With no IME involved (opening on a keyboard-free screen, or closing on send
 * or scroll) there is nothing to mirror, so the same fraction animates itself
 * over {@link PANEL_TRANSITION_MS}.
 *
 * `react-native-keyboard-controller` supplies both halves: `keyboardWillShow`
 * is emitted on the IME animation's first frame on both platforms (React
 * Native's own `Keyboard` module has no will-show event on Android), and
 * `progress` is a shared value driven on the UI thread for the duration of the
 * animation.
 *
 * @param open    whether the panel is currently open
 * @param setOpen closes (or opens) it
 */
export function useEmojiKeyboardSwap(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const { progress } = useReanimatedKeyboardAnimation();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** Whether the panel should render at all — it outlives `open` while it
   *  hands its space over to (or takes it back from) the IME. */
  const [panelMounted, setPanelMounted] = useState(open);

  /** 1 while the panel's height mirrors the IME, 0 while it animates alone. */
  const tracking = useSharedValue(0);
  /** 0..1 of the panel height, for the runs with no IME in the picture. */
  const ownFraction = useSharedValue(0);

  const openRef = useRef(open);
  openRef.current = open;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const keyboardVisibleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * What the panel may claim: the keyboard's height *minus the strip below the
   * chat*, which the keyboard covers but the chat itself does not.
   *
   * The chat's keyboard avoidance reserves the overlap between the keyboard and
   * its own frame, and that frame stops `insets.bottom` above the screen edge
   * (the screen renders a spacer there). A panel as tall as the raw keyboard
   * height would therefore sit 58-odd dp higher than the keyboard did, and the
   * composer would visibly step up as the two trade places.
   */
  const insets = useSafeAreaInsets();
  const measured = keyboardHeight || DEFAULT_PANEL_HEIGHT;
  const panelHeight = Math.max(
    measured - insets.bottom + COMPOSER_BOTTOM_INSET,
    MIN_PANEL_HEIGHT,
  );

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onWillShow = (event: { height: number }) => {
      keyboardVisibleRef.current = true;
      setKeyboardHeight(event.height);
      clearTimer();
      // From this frame the panel mirrors the IME. At progress 0 the mirrored
      // fraction is a full height, which is where the panel already is, so the
      // take-over is seamless in either direction.
      tracking.value = 1;
      ownFraction.value = 0;
      // Mount the panel now, at zero height, rather than when the emoji button
      // is tapped. Mounting it later raced the IME's own inset release by a
      // frame, and that frame is a visible dip in the composer.
      setPanelMounted(true);
      // Tapping the field is asking for the keyboard, so the panel steps aside.
      if (openRef.current) setOpenRef.current(false);
    };

    const onHide = () => {
      keyboardVisibleRef.current = false;
      // The IME has gone and the panel is closed: its space is zero by now, so
      // there is nothing left to render.
      if (!openRef.current) setPanelMounted(false);
    };

    const showSub = KeyboardEvents.addListener('keyboardWillShow', onWillShow);
    const willHideSub = KeyboardEvents.addListener('keyboardWillHide', onHide);
    const didHideSub = KeyboardEvents.addListener('keyboardDidHide', onHide);

    return () => {
      clearTimer();
      showSub.remove();
      willHideSub.remove();
      didHideSub.remove();
    };
  }, [ownFraction, tracking]);

  useEffect(() => {
    if (open) {
      setPanelMounted(true);
      if (keyboardVisibleRef.current) {
        // Opening over a keyboard that is on its way down: the panel grows
        // into exactly the space the IME gives back, frame for frame.
        tracking.value = 1;
        ownFraction.value = 0;
      } else {
        // No IME in the picture — the panel opens on its own.
        tracking.value = 0;
        ownFraction.value = withTiming(1, {
          duration: PANEL_TRANSITION_MS,
          easing: Easing.out(Easing.cubic),
        });
      }
      return;
    }

    // Closing. If the IME is rising it takes the space over (the will-show
    // listener above), so there is nothing to animate here.
    if (keyboardVisibleRef.current || !panelMounted) return;

    if (tracking.value === 1) {
      // Hand the tracked height to the panel's own animation at the value it
      // currently shows, so the switch cannot jump.
      ownFraction.value = 1 - progress.value;
      tracking.value = 0;
    }
    ownFraction.value = withTiming(
      0,
      { duration: PANEL_TRANSITION_MS, easing: Easing.out(Easing.cubic) },
      (finished) => {
        'worklet';
        if (finished) runOnJS(setPanelMounted)(false);
      },
    );
  }, [open, panelMounted, ownFraction, progress, tracking]);

  /** The panel's reserved height, animated. */
  const panelStyle = useAnimatedStyle(
    () => ({
      height:
        Math.max(0, tracking.value === 1 ? 1 - progress.value : ownFraction.value) *
        panelHeight,
    }),
    [panelHeight, ownFraction, progress, tracking],
  );

  /**
   * The user asked for the keyboard (touched the field, or tapped the keyboard
   * glyph) while the panel is open. The panel is *not* collapsed here — it
   * waits for the IME's own announcement a few milliseconds later and then
   * mirrors it. This only arms the fallback for a tap that never raises the
   * keyboard.
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
    /** The panel's full height — the IME's height on this screen. */
    panelHeight,
    /** Animated height of the space the panel occupies; pass to the picker. */
    panelStyle,
    /** Whether the picker should render (it outlives `open` during a swap). */
    panelMounted,
    startHandoff,
  };
}
