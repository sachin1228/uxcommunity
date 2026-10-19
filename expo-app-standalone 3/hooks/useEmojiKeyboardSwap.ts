import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardEvents,
  useKeyboardHandler,
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
 * The IME's last measured height (dp), remembered across mounts. Without it a
 * freshly opened chat would size its panel from DEFAULT_PANEL_HEIGHT until the
 * keyboard reported in once — the one case where the panel could still resize
 * under the user. The keyboard height is a property of the device, not of the
 * screen that happened to open it.
 */
let lastMeasuredImeHeight = 0;

/**
 * The composer's own bottom padding, always (dp). It is the strip between the
 * pill and whatever edge sits under it — the keyboard, or the panel while it
 * is open — so both edges sit the same distance from the composer and the
 * panel's top lands exactly on the keyboard's top edge.
 *
 * Constant on purpose. Dropping it while the panel is open would buy nothing
 * (the panel is laid out below it either way) and cost a frame: the padding
 * would vanish a few milliseconds before the panel's space grew into its place,
 * and the composer would dip by 8 dp for that frame.
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
 *     space = (1 - keyboardProgress) * panelHeight
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
 * Native's own `Keyboard` module has no will-show event on Android), and the
 * progress below is a shared value fed by the same per-frame handler the
 * chat's `KeyboardAvoidingView` uses for its own height.
 *
 * @param open    whether the panel is currently open
 * @param setOpen closes (or opens) it
 */
export function useEmojiKeyboardSwap(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  /**
   * The IME's progress, 0..1, frame by frame.
   *
   * Deliberately read through `useKeyboardHandler` rather than the provider's
   * `useReanimatedKeyboardAnimation`: the chat's avoidance animates its height
   * from this exact channel, so mirroring it here guarantees the two add up to
   * one keyboard's worth of space on every single frame. The provider's copy
   * comes from a different native path and can trail the avoidance while the
   * IME snaps open on Android — enough for the composer to hop and come back.
   */
  const progress = useSharedValue(0);
  /**
   * The IME's full height (dp), captured from the same per-frame handler that
   * drives the chat's avoidance. Sizing the panel from here rather than from
   * the JS `keyboardWillShow` event keeps it on the same value, and the same
   * thread, as the height the avoidance reserves — the two cannot disagree
   * about how much space the keyboard takes.
   */
  const imeHeight = useSharedValue(lastMeasuredImeHeight || DEFAULT_PANEL_HEIGHT);

  /** The IME's height as of the last show, for the picker's static content. */
  const [keyboardHeight, setKeyboardHeight] = useState(lastMeasuredImeHeight);

  /** Remember the IME's height for this screen and the next one. */
  const rememberImeHeight = (height: number) => {
    lastMeasuredImeHeight = height;
    setKeyboardHeight(height);
  };

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';

        if (e.height > 0) {
          imeHeight.value = e.height;
          runOnJS(rememberImeHeight)(e.height);
        }
      },
      onMove: (e) => {
        'worklet';

        progress.value = e.progress;
      },
      onInteractive: (e) => {
        'worklet';

        progress.value = e.progress;
      },
      onEnd: (e) => {
        'worklet';

        progress.value = e.progress;
      },
    },
    [],
  );

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
  // The panel's box: the keyboard's height less the safe-area strip the chat
  // reserves below it. The composer's constant padding above it then puts the
  // panel's top edge exactly on the keyboard's top edge.
  const panelHeight = Math.max(measured - insets.bottom, MIN_PANEL_HEIGHT);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onWillShow = () => {
      keyboardVisibleRef.current = true;
      clearTimer();

      if (!openRef.current) {
        // A plain keyboard open — the panel is shut, so it must not claim any
        // space. Its mirrored height is (1 - progress) of the full panel,
        // which at progress 0 is the *whole panel*: mirroring here used to
        // shove the composer straight to its final position on the IME's
        // first frame, leaving it to wait there while the keyboard slid up
        // underneath. With the panel flat, the chat's keyboard avoidance
        // alone moves the composer, in step with the IME.
        tracking.value = 0;
        ownFraction.value = 0;
        return;
      }

      // Tapping the field while emoji are open asks for the keyboard, so the
      // panel hands its space to the IME. It is already at full height, then
      // shrinks exactly as fast as the IME grows: the composer between them
      // never moves.
      tracking.value = 1;
      ownFraction.value = 0;
      setOpenRef.current(false);
    };

    const onHide = () => {
      keyboardVisibleRef.current = false;
      if (openRef.current) {
        // The panel is open and the IME is leaving: the panel mirrors it, so
        // its space grows back as the IME gives it up.
        return;
      }
      // The IME is leaving and the panel is shut. It owns no space, and must
      // not start mirroring the hide (that would cancel the chat's own
      // keyboard avoidance and leave the composer floating).
      tracking.value = 0;
      ownFraction.value = 0;
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
    if (keyboardVisibleRef.current) return;

    if (tracking.value === 1) {
      // Hand the tracked height to the panel's own animation at the value it
      // currently shows, so the switch cannot jump.
      ownFraction.value = 1 - progress.value;
      tracking.value = 0;
    }
    ownFraction.value = withTiming(0, {
      duration: PANEL_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, ownFraction, progress, tracking]);

  /** The space the panel occupies, animated — exactly the IME's complement. */
  const panelStyle = useAnimatedStyle(() => {
    const fraction = Math.max(
      0,
      tracking.value === 1 ? 1 - progress.value : ownFraction.value,
    );
    const imeSpace = Math.max(imeHeight.value - insets.bottom, MIN_PANEL_HEIGHT);

    return { height: fraction * imeSpace };
  }, [imeHeight, insets.bottom, ownFraction, progress, tracking]);

  /**
   * Call immediately before opening the panel (and, if one is up, dismissing
   * the IME). The panel is already in the layout at zero height; flipping it
   * to mirror the IME *before* the dismissal begins means both halves move on
   * the same frame. Waiting for the open effect would let the chat's keyboard
   * avoidance expand on its own for a frame while the panel was still flat.
   */
  const preparePanelOpen = () => {
    if (!keyboardVisibleRef.current) return;
    tracking.value = 1;
    ownFraction.value = 0;
  };

  /**
   * The user asked for the keyboard (touched the field, or tapped the keyboard
   * glyph) while the panel is open. The panel is *not* collapsed here — it
   * starts mirroring the IME from this moment, which at progress 0 is the full
   * panel already on screen, so nothing moves yet; every frame of the IME's
   * rise then takes its space back. Waiting for the IME's own announcement
   * would let the keyboard grow for a frame or two while the panel still held
   * its full height — a hop the user sees.
   *
   * This also arms the fallback for a tap that never raises the keyboard.
   *
   * Callers still focus the field themselves.
   */
  const startHandoff = () => {
    if (!openRef.current) return;
    tracking.value = 1;
    ownFraction.value = 0;
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
    /** Arm the IME mirror just before opening the panel over a keyboard. */
    preparePanelOpen,
    startHandoff,
  };
}
