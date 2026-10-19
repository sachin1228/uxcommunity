import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Platform, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AndroidSoftInputModes,
  KeyboardController,
  useGenericKeyboardHandler,
} from 'react-native-keyboard-controller';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

const DEFAULT_PANEL_HEIGHT = 320;
const MIN_PANEL_HEIGHT = 160;
const PANEL_TRANSITION_MS = 200;

let lastMeasuredKeyboardHeight = 0;

export interface CommunityChatImeLayout {
  panelOpen: boolean;
  panelHeight: number;
  panelStyle: AnimatedStyle<ViewStyle>;
  panelInteractive: boolean;
  /** Space reserved below the messages while the composer/IME dock is active. */
  listSpacerStyle: AnimatedStyle<ViewStyle>;
  /** Moves the composer dock with the IME while the screen itself stays fixed. */
  dockStyle: AnimatedStyle<ViewStyle>;
  onComposerStackLayout: (event: LayoutChangeEvent) => void;
  onTypingIndicatorLayout: (event: LayoutChangeEvent) => void;
  openEmojiPanel: () => void;
  requestKeyboard: () => void;
  closePanel: () => void;
}

/**
 * Owns the community chat's whole bottom layout: IME avoidance, composer and
 * emoji panel. Android is kept in adjustNothing while this screen is mounted,
 * so the system cannot resize the app while these views are also moving.
 *
 * The dock is anchored to the chat viewport's bottom. Its keyboard translation
 * and the emoji panel are complementary; the message list reserves the larger
 * of those two heights. During a handoff their sum stays fixed, so the composer
 * does not receive competing native-resize and React-layout updates.
 */
export function useCommunityChatImeLayout(enabled: boolean): CommunityChatImeLayout {
  const insets = useSafeAreaInsets();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelInteractive, setPanelInteractive] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(lastMeasuredKeyboardHeight);
  const panelHeight = Math.max(
    (keyboardHeight || DEFAULT_PANEL_HEIGHT) - insets.bottom,
    MIN_PANEL_HEIGHT,
  );

  const panelRequested = useSharedValue(false);
  const imeInset = useSharedValue(0);
  const panelExtent = useSharedValue(0);
  const targetPanelHeight = useSharedValue(panelHeight);
  const composerBaseHeight = useSharedValue(0);
  const typingIndicatorHeight = useSharedValue(0);
  const keyboardTargetVisible = useSharedValue(false);

  const panelOpenRef = useRef(false);
  const panelRequestedRef = useRef(false);
  const panelHeightRef = useRef(panelHeight);
  panelHeightRef.current = panelHeight;

  useLayoutEffect(() => {
    targetPanelHeight.value = panelHeight;
    // Safe-area bottom can change as Android moves between the IME and the
    // app's navigation area. Keep the open panel's far edge anchored to the
    // same screen coordinate when that happens.
    if (panelRequested.value && imeInset.value <= 1) {
      panelExtent.value = panelHeight;
    }
  }, [imeInset, panelExtent, panelHeight, panelRequested, targetPanelHeight]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;

    // The chat owns the IME geometry while mounted. Restore the app's default
    // mode when leaving the route so other screens keep their normal behavior.
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => KeyboardController.setDefaultMode();
  }, [enabled]);

  const setPanelOpenState = useCallback((open: boolean) => {
    panelOpenRef.current = open;
    setPanelOpen(open);
  }, []);

  const setPanelInteractiveState = useCallback((interactive: boolean) => {
    // Worklet callbacks can reach JS one frame after a newer button press.
    // Never let a completed old open animation reactivate a panel the user
    // has already switched away from.
    if (interactive && !panelRequestedRef.current) return;
    setPanelInteractive(interactive);
  }, []);

  const finishPanelOpening = useCallback((finished?: boolean) => {
    'worklet';

    if (finished && panelRequested.value && imeInset.value <= 1) {
      runOnJS(setPanelInteractiveState)(true);
    }
  }, [imeInset, panelRequested, setPanelInteractiveState]);

  const closeFromKeyboard = useCallback(() => {
    // Keyboard events are dispatched across the UI/JS boundary. A newer emoji
    // tap may have won while this callback was queued.
    if (panelRequestedRef.current) return;
    panelOpenRef.current = false;
    setPanelInteractive(false);
    setPanelOpenState(false);
  }, [setPanelOpenState]);

  const saveKeyboardHeight = useCallback((height: number) => {
    lastMeasuredKeyboardHeight = height;
    setKeyboardHeight(height);
  }, []);

  const keepKeyboardHiddenForPanel = useCallback(() => {
    if (panelOpenRef.current) {
      KeyboardController.dismiss();
    }
  }, []);

  useGenericKeyboardHandler(
    {
      onStart: (event) => {
        'worklet';

        keyboardTargetVisible.value = event.progress > 0.5;
        if (event.progress > 0.5) {
          if (panelRequested.value) runOnJS(keepKeyboardHiddenForPanel)();
          else runOnJS(closeFromKeyboard)();
        }
      },
      onMove: (event) => {
        'worklet';

        imeInset.value = Math.max(0, event.height - insets.bottom);
      },
      onInteractive: (event) => {
        'worklet';

        imeInset.value = Math.max(0, event.height - insets.bottom);
      },
      onEnd: (event) => {
        'worklet';

        const height = Math.max(0, event.height - insets.bottom);
        imeInset.value = height;
        keyboardTargetVisible.value = event.height > 0;

        if (event.height > 0) {
          runOnJS(saveKeyboardHeight)(event.height);
          if (panelRequested.value) {
            // A show event can finish after an emoji tap raced the native
            // animation. Keep the selected mode and immediately finish the
            // requested hide instead of letting the old show win.
            runOnJS(keepKeyboardHiddenForPanel)();
          } else {
            panelExtent.value = 0;
          }
          return;
        }

        if (panelRequested.value) {
          const target = targetPanelHeight.value;
          if (panelExtent.value < target) {
            cancelAnimation(panelExtent);
            panelExtent.value = withTiming(
              target,
              { duration: PANEL_TRANSITION_MS, easing: Easing.out(Easing.cubic) },
              finishPanelOpening,
            );
          } else {
            runOnJS(setPanelInteractiveState)(true);
          }
        } else if (panelExtent.value > 0) {
          cancelAnimation(panelExtent);
          panelExtent.value = withTiming(0, {
            duration: PANEL_TRANSITION_MS,
            easing: Easing.out(Easing.cubic),
          });
        }
      },
    },
    [
      closeFromKeyboard,
      finishPanelOpening,
      insets.bottom,
      keepKeyboardHiddenForPanel,
      saveKeyboardHeight,
      setPanelInteractiveState,
    ],
  );

  const openEmojiPanel = useCallback(() => {
    panelRequestedRef.current = true;
    panelRequested.value = true;
    setPanelOpenState(true);
    setPanelInteractive(false);

    const currentOccupied = Math.max(imeInset.value, panelExtent.value);
    const target = Math.max(panelHeightRef.current, currentOccupied);
    targetPanelHeight.value = target;
    cancelAnimation(panelExtent);
    panelExtent.value = currentOccupied;
    panelExtent.value = withTiming(
      target,
      { duration: PANEL_TRANSITION_MS, easing: Easing.out(Easing.cubic) },
      finishPanelOpening,
    );

    KeyboardController.dismiss();
  }, [
    cancelAnimation,
    finishPanelOpening,
    imeInset,
    panelExtent,
    panelRequested,
    setPanelOpenState,
    targetPanelHeight,
  ]);

  const requestKeyboard = useCallback(() => {
    panelRequested.value = false;
    panelRequestedRef.current = false;
    setPanelInteractive(false);
    setPanelOpenState(false);
    cancelAnimation(panelExtent);
    // Keep the panel's occupied height until the IME reports its own frame;
    // the transition formula below hands the exact space over to the keyboard.
  }, [cancelAnimation, panelExtent, panelRequested, setPanelOpenState]);

  const closePanel = useCallback(() => {
    panelRequested.value = false;
    panelRequestedRef.current = false;
    setPanelInteractive(false);
    setPanelOpenState(false);

    if (keyboardTargetVisible.value || imeInset.value > 1) return;

    cancelAnimation(panelExtent);
    panelExtent.value = withTiming(0, {
      duration: PANEL_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    cancelAnimation,
    imeInset,
    keyboardTargetVisible,
    panelExtent,
    panelRequested,
    setPanelOpenState,
  ]);

  const onComposerStackLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height + 2 + 8;
    composerBaseHeight.value = measured;
  }, [composerBaseHeight]);

  const onTypingIndicatorLayout = useCallback((event: LayoutChangeEvent) => {
    typingIndicatorHeight.value = event.nativeEvent.layout.height;
  }, [typingIndicatorHeight]);

  const panelStyle = useAnimatedStyle(() => ({
    height: Math.max(0, panelExtent.value - imeInset.value),
  }), [imeInset, panelExtent]);

  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -imeInset.value }],
  }), [imeInset]);

  const listSpacerStyle = useAnimatedStyle(() => ({
    height:
      composerBaseHeight.value +
      typingIndicatorHeight.value +
      Math.max(imeInset.value, panelExtent.value),
  }), [composerBaseHeight, imeInset, panelExtent, typingIndicatorHeight]);

  return {
    panelOpen,
    panelHeight,
    panelStyle,
    panelInteractive,
    listSpacerStyle,
    dockStyle,
    onComposerStackLayout,
    onTypingIndicatorLayout,
    openEmojiPanel,
    requestKeyboard,
    closePanel,
  };
}
