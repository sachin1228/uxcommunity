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
  runOnUI,
  type AnimatedStyle,
} from 'react-native-reanimated';

const DEFAULT_PANEL_HEIGHT = 320;
const MIN_PANEL_HEIGHT = 160;
const PANEL_TRANSITION_MS = 200;
export const CHAT_COMPOSER_BOTTOM_INSET = 8;
export const CHAT_COMPOSER_TOP_INSET = 2;

let lastMeasuredKeyboardHeight = 0;
let androidImeOwnerCount = 0;

export interface ChatImeLayout {
  panelOpen: boolean;
  /** Synchronous desired mode for taps that arrive before React rerenders. */
  panelOpenRef: { current: boolean };
  panelHeight: number;
  panelStyle: AnimatedStyle<ViewStyle>;
  panelInteractive: boolean;
  /** Space reserved below the messages while the composer/IME dock is active. */
  listSpacerStyle: AnimatedStyle<ViewStyle>;
  /** Moves the composer dock with the IME while the screen itself stays fixed. */
  dockStyle: AnimatedStyle<ViewStyle>;
  onComposerStackLayout: (event: LayoutChangeEvent) => void;
  /** Measures a fixed footer state that has no composer or emoji panel. */
  onFixedDockLayout: (event: LayoutChangeEvent) => void;
  onTypingIndicatorLayout: (event: LayoutChangeEvent) => void;
  openEmojiPanel: () => void;
  requestKeyboard: (restoreFocus?: () => void) => void;
  closePanel: () => void;
}

/**
 * Owns a chat surface's whole bottom layout: IME avoidance, composer and
 * emoji panel. Android is kept in adjustNothing while this screen is mounted,
 * so the system cannot resize the app while these views are also moving.
 *
 * The composer dock keeps a fixed measured height. Its translation reserves
 * the larger of the IME and panel extents, while the panel is absolutely
 * positioned below the composer; neither panel animation nor native keyboard
 * callbacks can change the dock's Yoga height during a handoff.
 */
export function useChatImeLayout(
  enabled: boolean,
  composerSpacing: { top?: number; bottom?: number } = {},
): ChatImeLayout {
  const insets = useSafeAreaInsets();
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelInteractive, setPanelInteractive] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(lastMeasuredKeyboardHeight);
  const panelHeight = Math.max(
    (keyboardHeight || DEFAULT_PANEL_HEIGHT) - insets.bottom,
    MIN_PANEL_HEIGHT,
  );

  const panelRequested = useSharedValue(false);
  // Mode changes are serialized on the UI runtime with the keyboard's
  // animation values. The monotonically increasing request id makes a queued
  // older tap harmless if a faster tap reaches the UI runtime first.
  const modeRequestId = useSharedValue(0);
  const imeInset = useSharedValue(0);
  const panelExtent = useSharedValue(0);
  const targetPanelHeight = useSharedValue(panelHeight);
  const composerBaseHeight = useSharedValue(0);
  const typingIndicatorHeight = useSharedValue(0);
  const keyboardTargetVisible = useSharedValue(false);
  const imeAnimationRunning = useSharedValue(false);
  // Keyboard show can be requested before the native animation's onStart.
  // Carry that intent across an immediately following emoji-panel tap.
  const keyboardShowPending = useSharedValue(false);
  const panelDismissPending = useSharedValue(false);
  const restoreKeyboardAfterPanelDismiss = useSharedValue(false);
  const ownerEnabled = useSharedValue(enabled);
  const composerTopSpacing = composerSpacing.top ?? CHAT_COMPOSER_TOP_INSET;
  const composerBottomSpacing = composerSpacing.bottom ?? CHAT_COMPOSER_BOTTOM_INSET;

  const panelOpenRef = useRef(false);
  const panelRequestedRef = useRef(false);
  const modeRequestRef = useRef(0);
  const focusInputRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    ownerEnabled.value = enabled;
    if (!enabled) {
      panelRequested.value = false;
      panelRequestedRef.current = false;
      panelOpenRef.current = false;
      setPanelOpen(false);
      setPanelInteractive(false);
      keyboardTargetVisible.value = false;
      imeAnimationRunning.value = false;
      keyboardShowPending.value = false;
      panelDismissPending.value = false;
      restoreKeyboardAfterPanelDismiss.value = false;
      imeInset.value = 0;
      cancelAnimation(panelExtent);
      panelExtent.value = 0;
    }
  }, [
    cancelAnimation,
    enabled,
    imeInset,
    imeAnimationRunning,
    keyboardTargetVisible,
    keyboardShowPending,
    panelDismissPending,
    ownerEnabled,
    panelExtent,
    panelRequested,
    restoreKeyboardAfterPanelDismiss,
  ]);

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

    // Routes and full-screen modals can remain mounted underneath one another.
    // Keep adjustNothing active until the last focused chat surface releases it.
    androidImeOwnerCount += 1;
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => {
      androidImeOwnerCount = Math.max(0, androidImeOwnerCount - 1);
      if (androidImeOwnerCount === 0) KeyboardController.setDefaultMode();
    };
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

  const restoreRequestedKeyboard = useCallback(() => {
    focusInputRef.current?.();
  }, []);

  const dismissImeForPanel = useCallback((requestId: number) => {
    // runOnJS is asynchronous. A newer keyboard tap may arrive after the UI
    // worklet queues this callback but before JavaScript executes it. Never let
    // that stale native dismiss reverse the user's newer mode request.
    if (
      panelRequestedRef.current &&
      modeRequestRef.current === requestId
    ) {
      KeyboardController.dismiss();
    }
  }, []);

  const beginEmojiPanelOnUI = useCallback((requestId: number) => {
    'worklet';

    if (!ownerEnabled.value || requestId < modeRequestId.value) return;
    modeRequestId.value = requestId;
    panelDismissPending.value =
      keyboardShowPending.value || keyboardTargetVisible.value || imeInset.value > 1;
    keyboardShowPending.value = false;
    restoreKeyboardAfterPanelDismiss.value = false;
    panelRequested.value = true;

    // Read both animated values on the UI runtime, where the IME handler owns
    // them. Reading them from the tap's JS callback could capture the previous
    // frame (zero), allowing Android to finish hiding the keyboard before the
    // custom panel had claimed its occupied height.
    const currentOccupied = Math.max(imeInset.value, panelExtent.value);
    const target = Math.max(targetPanelHeight.value, currentOccupied);
    targetPanelHeight.value = target;
    cancelAnimation(panelExtent);
    if (imeAnimationRunning.value && keyboardTargetVisible.value) {
      // Let an in-flight keyboard show finish at its native height before
      // seeding the panel. Moving the dock to the panel's final extent now
      // would race the still-growing IME and move the composer prematurely.
      panelExtent.value = currentOccupied;
    } else if (currentOccupied > 1 || keyboardTargetVisible.value) {
      // When the IME already occupies the bottom of the window, lay out the
      // complete panel underneath it before asking Android to dismiss. The
      // system keyboard overlays app content; it will uncover this panel as it
      // moves away. Animating the panel's clip against IME events leaves a
      // blank gap because Android can finish drawing the hide before the
      // keyboard handler publishes its final zero-height frame.
      panelExtent.value = target;
    } else {
      // With no native keyboard to hand off, reveal the panel in the usual
      // short animation from the bottom of the screen.
      panelExtent.value = currentOccupied;
      panelExtent.value = withTiming(
        target,
        { duration: PANEL_TRANSITION_MS, easing: Easing.out(Easing.cubic) },
        finishPanelOpening,
      );
    }

    // Dismiss only after the shared occupied extent is seeded on the UI
    // runtime, so the native IME and our panel trade the same space. If the
    // IME is already animating, onEnd applies this latest panel intent instead
    // of cancelling Android's in-flight Insets animator.
    if (
      !imeAnimationRunning.value &&
      (keyboardTargetVisible.value || imeInset.value > 1)
    ) {
      runOnJS(dismissImeForPanel)(requestId);
    }
  }, [
    cancelAnimation,
    dismissImeForPanel,
    finishPanelOpening,
    imeInset,
    imeAnimationRunning,
    keyboardShowPending,
    keyboardTargetVisible,
    modeRequestId,
    ownerEnabled,
    panelDismissPending,
    panelExtent,
    panelRequested,
    restoreKeyboardAfterPanelDismiss,
    targetPanelHeight,
  ]);

  const prepareKeyboardOnUI = useCallback((requestId: number, wasPanelOpen: boolean) => {
    'worklet';

    if (!ownerEnabled.value || requestId < modeRequestId.value) return;
    modeRequestId.value = requestId;
    restoreKeyboardAfterPanelDismiss.value = panelDismissPending.value;
    keyboardShowPending.value = true;
    panelRequested.value = false;
    cancelAnimation(panelExtent);

    if (wasPanelOpen && !imeAnimationRunning.value && imeInset.value <= 1) {
      // The panel is settled and no native transition is active, so the
      // keyboard can take focus immediately.
      runOnJS(restoreRequestedKeyboard)();
    } else if (
      wasPanelOpen &&
      imeAnimationRunning.value &&
      !keyboardTargetVisible.value
    ) {
      // Let an in-flight hide finish before restoring focus. Asking the IME to
      // show mid-hide cancels Android's current Insets animator.
      restoreKeyboardAfterPanelDismiss.value = true;
    }
  }, [
    cancelAnimation,
    imeAnimationRunning,
    imeInset,
    keyboardTargetVisible,
    keyboardShowPending,
    modeRequestId,
    ownerEnabled,
    panelDismissPending,
    panelExtent,
    panelRequested,
    restoreKeyboardAfterPanelDismiss,
    restoreRequestedKeyboard,
  ]);

  const closePanelOnUI = useCallback((requestId: number) => {
    'worklet';

    if (!ownerEnabled.value || requestId < modeRequestId.value) return;
    modeRequestId.value = requestId;
    keyboardShowPending.value = false;
    panelDismissPending.value = false;
    restoreKeyboardAfterPanelDismiss.value = false;
    panelRequested.value = false;

    if (keyboardTargetVisible.value || imeInset.value > 1) return;

    cancelAnimation(panelExtent);
    panelExtent.value = withTiming(0, {
      duration: PANEL_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    cancelAnimation,
    imeInset,
    keyboardShowPending,
    keyboardTargetVisible,
    modeRequestId,
    ownerEnabled,
    panelDismissPending,
    panelExtent,
    panelRequested,
    restoreKeyboardAfterPanelDismiss,
  ]);

  useGenericKeyboardHandler(
    {
      onStart: (event) => {
        'worklet';
        if (!ownerEnabled.value) return;

        imeAnimationRunning.value = true;
        keyboardTargetVisible.value = event.progress > 0.5;
        if (event.progress > 0.5) {
          // If a panel tap arrives while the keyboard is entering, preserve
          // that intent and let onEnd request the hide after this animation.
          if (!panelRequested.value) runOnJS(closeFromKeyboard)();
        }
      },
      onMove: (event) => {
        'worklet';
        if (!ownerEnabled.value) return;

        imeInset.value = Math.max(0, event.height - insets.bottom);
      },
      onInteractive: (event) => {
        'worklet';
        if (!ownerEnabled.value) return;

        imeInset.value = Math.max(0, event.height - insets.bottom);
      },
      onEnd: (event) => {
        'worklet';
        if (!ownerEnabled.value) return;

        imeAnimationRunning.value = false;
        const height = Math.max(0, event.height - insets.bottom);
        imeInset.value = height;
        keyboardTargetVisible.value = event.height > 0;

        if (event.height > 0) {
          runOnJS(saveKeyboardHeight)(event.height);
          keyboardShowPending.value = false;
          if (panelRequested.value) {
            // A show event can finish after an emoji tap raced the native
            // animation. Seed a full-height panel at the measured IME extent,
            // then dismiss only after Android has finished this show. This
            // also avoids using the old (possibly default) panel height on a
            // first-use or very fast toggle.
            const occupied = Math.max(0, event.height - insets.bottom);
            const target = Math.max(occupied, MIN_PANEL_HEIGHT);
            targetPanelHeight.value = target;
            cancelAnimation(panelExtent);
            panelExtent.value = target;
            runOnJS(keepKeyboardHiddenForPanel)();
          } else if (
            panelDismissPending.value &&
            restoreKeyboardAfterPanelDismiss.value
          ) {
            // A show completion can arrive before the older emoji-requested
            // dismiss completion. Keep the occupied panel extent and both
            // pending flags until that hide is reconciled below; otherwise a
            // late height=0 event would collapse the dock for one frame.
            panelExtent.value = Math.max(panelExtent.value, height);
          } else {
            panelDismissPending.value = false;
            restoreKeyboardAfterPanelDismiss.value = false;
            panelExtent.value = 0;
          }
          return;
        }

        if (!panelRequested.value && restoreKeyboardAfterPanelDismiss.value) {
          // A dismiss requested by the previous emoji-panel transition finished
          // after the user had already asked for the keyboard. Keep the dock's
          // occupied height in place and restore focus; the ensuing keyboard
          // show event will take over that same space without a collapsed frame.
          panelDismissPending.value = false;
          restoreKeyboardAfterPanelDismiss.value = false;
          // Keep the show pending until the restored keyboard reports height;
          // another panel request can interrupt the focus handoff meanwhile.
          runOnJS(restoreRequestedKeyboard)();
          return;
        }

        keyboardShowPending.value = false;
        panelDismissPending.value = false;
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
      cancelAnimation,
      finishPanelOpening,
      insets.bottom,
      imeAnimationRunning,
      keyboardShowPending,
      keyboardTargetVisible,
      keepKeyboardHiddenForPanel,
      ownerEnabled,
      panelDismissPending,
      panelExtent,
      panelRequested,
      restoreKeyboardAfterPanelDismiss,
      restoreRequestedKeyboard,
      saveKeyboardHeight,
      setPanelInteractiveState,
      targetPanelHeight,
    ],
  );

  const openEmojiPanel = useCallback(() => {
    const requestId = ++modeRequestRef.current;
    panelRequestedRef.current = true;
    setPanelOpenState(true);
    setPanelInteractive(false);
    runOnUI(beginEmojiPanelOnUI)(requestId);
  }, [
    beginEmojiPanelOnUI,
    setPanelOpenState,
  ]);

  const requestKeyboard = useCallback((restoreFocus?: () => void) => {
    const requestId = ++modeRequestRef.current;
    if (restoreFocus) focusInputRef.current = restoreFocus;
    const wasPanelOpen = panelOpenRef.current;
    panelRequestedRef.current = false;
    setPanelInteractive(false);
    setPanelOpenState(false);
    runOnUI(prepareKeyboardOnUI)(requestId, wasPanelOpen);
    // Keep the panel's occupied height until the IME reports its own frame;
    // the transition formula below hands the exact space over to the keyboard.
  }, [prepareKeyboardOnUI, setPanelOpenState]);

  const closePanel = useCallback(() => {
    const requestId = ++modeRequestRef.current;
    panelRequestedRef.current = false;
    setPanelInteractive(false);
    setPanelOpenState(false);
    runOnUI(closePanelOnUI)(requestId);
  }, [
    closePanelOnUI,
    setPanelOpenState,
  ]);

  const onComposerStackLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height + composerTopSpacing + composerBottomSpacing;
    composerBaseHeight.value = measured;
  }, [composerBottomSpacing, composerBaseHeight, composerTopSpacing]);

  const onFixedDockLayout = useCallback((event: LayoutChangeEvent) => {
    composerBaseHeight.value = event.nativeEvent.layout.height;
  }, [composerBaseHeight]);

  const onTypingIndicatorLayout = useCallback((event: LayoutChangeEvent) => {
    typingIndicatorHeight.value = event.nativeEvent.layout.height;
  }, [typingIndicatorHeight]);

  const panelStyle = useAnimatedStyle(() => ({
    // This full panel lives under the system IME during a handoff. Android
    // occludes it while the keyboard is visible, so subtracting imeInset here
    // incorrectly clips it to zero until the keyboard handler catches up with
    // the native hide animation.
    height: Math.max(0, panelExtent.value),
  }), [panelExtent]);

  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(imeInset.value, panelExtent.value) }],
  }), [imeInset, panelExtent]);

  const listSpacerStyle = useAnimatedStyle(() => ({
    height:
      composerBaseHeight.value +
      typingIndicatorHeight.value +
      Math.max(imeInset.value, panelExtent.value),
  }), [composerBaseHeight, imeInset, panelExtent, typingIndicatorHeight]);

  return {
    panelOpen,
    panelOpenRef,
    panelHeight,
    panelStyle,
    panelInteractive,
    listSpacerStyle,
    dockStyle,
    onComposerStackLayout,
    onFixedDockLayout,
    onTypingIndicatorLayout,
    openEmojiPanel,
    requestKeyboard,
    closePanel,
  };
}
