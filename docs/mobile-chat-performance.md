# Mobile community chat loading

The community screen renders the local message window immediately, including
messages received while the chat screen was closed. An independent cursor sync
repairs any missed messages. This replaces the previous sequence of transition
gate → bundled bootstrap → image measurement → debounced catch-up.

## Display and synchronization

`communityMessageStore.ts` owns bounded message windows independently of screens.
The runtime adapter supplies AsyncStorage and the existing authenticated
messages-only API. The realtime client feeds inserts, edits, deletions, reactions
and retention events into that store, even when only the community list is mounted.

- A warm room supplies its rows synchronously on the hook's first render.
- Cold launches hydrate account-scoped disk rows without waiting for HTTP.
- Opening, pressing a row, receiving an Expo notification, or a native Android
  notification hint can start the same deduplicated sync.
- The first read uses `/messages`; later reads use compound `after` cursors.
  Cards use `bootstrap?section=content-events` independently. Full community
  details, member previews and rules cannot block the message response.
- There is no 340 ms transition gate or 300 ms open-time debounce. An actual
  cache miss displays a spinner after 150 ms; that timer never holds data back.
- Image warming is asynchronous on initial loads, catch-up and pagination.
  Existing cached ratios and placeholder frames remain available to bubbles.
- The existing small FlatList render batches remain in place to limit work
  during the navigation animation.

## Preserve the recovery checkpoint

The newest displayed message is not necessarily a safe synchronization cursor.
For example, a disconnected client can miss M11 and then receive M12 live. Its
next read must still start after M10.

Each persisted window therefore stores `syncedThrough` separately from its rows.
Only successful API pages advance this checkpoint. Live messages and confirmed
POST responses update the display and disk window without advancing it. A window
created solely from live messages stores an explicit null checkpoint, so it
fetches a latest page before attempting delta recovery. Existing cache files
without the new field infer the checkpoint from their complete saved window.

A socket opening while an HTTP read is in flight requests one trailing sync;
this closes the gap between the HTTP snapshot and the subscription becoming
live. Long gaps drain in bounded page groups. Rooms and accounts cannot share
pending reads or windows, including logout followed by login to the same account.

Memory retains at most 40 inactive room windows, with mounted/in-flight rooms
pinned. Each window contains at most 120 confirmed messages. Disk writes coalesce
over 500 ms and flush on navigation/background. The existing disk bounds,
15-day retention and member-scoped logout cleanup remain in effect.

## Android notification delivery

Pushes can carry the exact committed message fields alongside the shortened
notification preview. Snapshots are bound to the recipient's member ID and are
limited to 1,800 UTF-8 bytes; the combined payload must remain below 3,000 bytes,
leaving room under the providers' 4,096-byte limit. Oversized messages retain
the normal notification and use API recovery. Displaying the pushed row never
advances the gap-recovery checkpoint.

Direct Android FCM delivery is handled by the existing custom native service,
which bypasses Expo's JS notification-receipt listener. The service now records
bounded, account-scoped community hints and snapshots and emits them when JS runs.
On launch/resume, JS consumes at most three pending targets and starts their
authenticated syncs. A valid snapshot is displayed before that network read.
Expo receipts and notification taps can seed the same local window. Notification
preview text is never inserted as a complete chat message. API pages fill missing
quote/author previews without discarding a newer edit or local upload preview.

These native hints need a new Android build. The JS changes also work on older
native builds; they retain tap-time syncing and the Expo receipt listener.
The push snapshot needs the updated backend sender too. When the OS has suspended
the app, a missing or oversized snapshot still needs a successful network read.
Background notification delivery and background JS execution are not guaranteed
by either mobile OS.

## Research applied

- [Android's offline-first data layer](https://developer.android.com/topic/architecture/data-layer/offline-first):
  display local data immediately and reconcile through a shared repository.
- [Messenger's mobile-first infrastructure](https://engineering.fb.com/2014/10/09/production-engineering/building-mobile-first-infrastructure-for-messenger/):
  snapshot-plus-delta synchronization updates the local conversation copy;
  independent checkpoints recover interrupted delivery. This historical article
  motivates the pattern, rather than claiming this app implements Messenger's protocol.
- [Expo's offline-first application article](https://expo.dev/blog/offline-first-apps-with-expo-and-legend-state)
  and [local-first architecture guide](https://docs.expo.dev/guides/local-first/):
  persistence and synchronization belong below the screen. This change keeps the
  existing bounded AsyncStorage windows; replacing the database would not itself
  remove display gates or correct a missing checkpoint.
- [React Native 0.81 FlatList guidance](https://reactnative.dev/docs/0.81/optimizing-flatlist-configuration):
  keep the initial render and subsequent batches bounded.
- [Expo notification behavior](https://docs.expo.dev/push-notifications/what-you-need-to-know/):
  distinguish receipt, tap and background delivery, and keep foreground recovery
  available when the OS does not execute a background handler.
- [FCM payload limits](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type)
  and [Expo's payload limit](https://docs.expo.dev/push-notifications/sending-notifications/):
  measure encoded bytes and omit the snapshot when it cannot fit safely.

## Validation

Run `npm run test:mobile-chat-open` from the repository root. It covers the pure
store, disk checkpoint compatibility, realtime lifecycle, the actual React hook
and runtime adapter with controlled native/network boundaries, and the existing
bootstrap cache contracts. React is the mobile app's installed 19.1 version;
the test renderer is only a development dependency. CI installs both lockfiles,
checks the mobile TypeScript project, and runs these tests.

The hook tests hold HTTP and media promises open to verify local rows render
without them, check the first-render loading state, switch rooms, and confirm
optimistic image sends. Store tests cover missed-message gaps, delayed disk reads,
socket/HTTP races, duplicate triggers, persistence, retention and account changes.
The Node bootstrap runner stubs only native credential storage so its existing
tests can run without trying to parse React Native's Flow entry point.

Physical-device tap-to-paint, navigation frame pacing and background notification
delivery must be checked on a release build. Automated test durations are not
device latency measurements. The local Android Kotlin compilation validates the
native bridge; this workspace had no connected device for a visual performance run.
