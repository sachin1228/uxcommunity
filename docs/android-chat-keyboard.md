# Android chat keyboard layout

Community chat and direct messages keep the header, tabs and message viewport
fixed while the keyboard animates. The composer follows the keyboard on the UI
runtime. A native scroll inset reserves the occupied keyboard/emoji-panel area:

- At the newest messages (within the screen's existing bottom threshold), the
  list follows the composer with immediate native scroll commands.
- While reading history, native inset compensation preserves the visible
  message position. Closing the keyboard also preserves that position, subject
  to the native scroll range at the ends of history.
- Starting a drag cancels pending follow commands. Follow eligibility is
  captured once per transition, so inset-generated scroll events cannot change
  the decision halfway through an animation.
- Keyboard and emoji handoffs share `max(imeInset, panelExtent)`. Their heights
  are never added together.

Previously, `listSpacerStyle.height` included the animated keyboard extent.
Every IME frame therefore resized the FlatList through Yoga, and the inverted
list shifted even when the member was reading history. The spacer now measures
only the composer and typing indicator for the two Android chat screens.
Other shared-hook consumers and iOS keep their existing avoidance behavior.
The DM's additional `keyboardDidShow` smooth scroll has also been removed.
Both lists disable native visible-content anchoring at the newest rows and
enable it while reading history, so a new message does not anchor behind the dock.

`ChatScrollView.android.tsx` uses keyboard-controller's `ClippingScrollView`
native decorator, introduced in 1.21. The dependency is pinned to 1.21.14.
It extends Android's scroll range and compensates content translation without
changing the FlatList's Yoga dimensions. The adapter uses this primitive rather
than a second keyboard handler: the existing shared layout must continue to own
the emoji-panel state machine and Android input mode. Android stays in
`adjustNothing` while a chat surface owns the dock.

## Research

- [The library author's explanation and open-source implementation](https://kirillzyusko.github.io/react-native-keyboard-controller/blog/chat-scroll-view)
  explains the cost of per-frame layout and the native inset decorator.
- [KeyboardChatScrollView behavior](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/1.21.0/api/components/keyboard-chat-scroll-view)
  documents conditional lifting with `whenAtEnd`.
- [Reanimated performance guidance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
  recommends avoiding layout-affecting animated properties when possible.
- [Upstream inverted-list anchoring report](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1423)
  and [interactive keyboard report](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1313)
  informed the history, dismissal and handoff regression cases. These are
  upstream reports, not proof of a particular cause in this application.

## Validation

Run `node --test "expo-app-standalone 3/tests/chat-keyboard.test.mjs"` from the
repository root, plus the mobile TypeScript check and `npm run test:mobile-chat-open`.
The keyboard suite executes the actual hook and Android scroll adapter with
controlled native boundaries. It checks frame-by-frame spacer invariance,
history anchoring, dismissal after scrolling, emoji swaps, drag cancellation,
other hook consumers and focus cleanup. It does not measure device frame rates.

The rebuilt Android app was also checked with a temporary local 150-row fixture
using these actual components (no server messages were sent). Native UI bounds
confirmed that two latest messages and the composer rose by the same 820 physical
pixels, while the header and tabs stayed fixed. Ten history messages retained
identical screen coordinates when the keyboard opened. A keyboard-to-emoji-to-
keyboard swap retained the latest row position within one physical pixel of
rounding. The temporary route was removed after verification. These checks
validate positioning; they are not a physical-phone frame-pacing measurement.

A native rebuild is required after installing the upgraded keyboard controller;
Metro refresh alone cannot add the new native scroll decorator. Verify a release
build on a physical Android phone for final frame pacing. Check long history,
latest messages, open/close, keyboard/emoji swaps, multiline input, image/reply
previews, send and incoming messages while reading history.
