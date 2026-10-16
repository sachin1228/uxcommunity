# Mobile app — current-state inventory (web-vs-mobile parity prep)

Audit of the Expo / React Native app at `expo-app-standalone 3/` (92 tracked files, excluding
`assets/`, `node_modules/`, gitignored `android/`, `ios/`). Source of truth for parity is
`apps/web` (Next.js). This document describes only what the mobile app does **today**, with
`file:line` citations. Read-only audit; no app code was modified.

Legend for citations: paths are relative to the repo root. `MA` = `expo-app-standalone 3/`.

---

## 1. Screen inventory

### 1.1 Summary table

| Route file | Purpose | Realtime rooms subscribed | Loading | Empty | Error | Backend APIs (method + path) |
|---|---|---|---|---|---|---|
| `MA/app/index.tsx` | Auth-based entry redirect (`Redirect` to `/(tabs)/communities` or `/(auth)/login`), spinner while `isLoading` | — | yes (spinner) | n/a | n/a | none (uses `AuthContext`) |
| `MA/app/(auth)/_layout.tsx` | Auth stack; redirects to `(tabs)` the moment `user` appears | — | n/a | n/a | n/a | none |
| `MA/app/(auth)/login.tsx` | Email/password sign-in | — | button spinner | n/a | inline error banner (`:91-102`) | `POST /api/auth/login`, then `GET /api/auth/me` (via `login()`) |
| `MA/app/(tabs)/_layout.tsx` | Bottom tabs; iOS 26+ `NativeTabs` (liquid glass) vs classic blurred `Tabs` (`:132-137`) | — | n/a | n/a | n/a | none |
| `MA/app/(tabs)/index.tsx` | Home — cross-community card feed (threads/events/resources/showcase), read-only edit/delete | none | `ActivityIndicator` (`:115-118`) | "No posts yet" (`:150-159`) | error card + Try again (`:119-127`) | `GET /api/home/feed` (`?before=`), card actions `POST /api/communities/:id/:kind/:itemId/{like|save|bookmark}`, showcase `POST /…/showcase/:id` `{action,active}`, events `POST …/rsvp`; comments via CommentsSheet; `GET /api/link-preview?url=` |
| `MA/app/(tabs)/communities.tsx` | Community list (WhatsApp-style rows, unread badges, typing, last message/reaction preview) | `chat:<id>` for top-10 live window (via `useCommunities`) | spinner (`:69-73`) | "No communities yet" (`:84-92`) | error + Retry (`:75-82`) — **sticky, see §8** | `GET /api/communities`; `PATCH /api/communities/:id/read` on press; `GET /api/communities/:id/members/:uid` (name resolution); `GET /api/communities/:id/messages/:mid` (reply/reaction preview) |
| `MA/app/(tabs)/explore.tsx` | **Placeholder** — "Explore — coming soon" (`:15`) | — | none | n/a | n/a | none |
| `MA/app/(tabs)/jobs.tsx` | **Placeholder** — "Jobs — coming soon" (`:15`) | — | none | n/a | n/a | none |
| `MA/app/community/[id].tsx` | Community chat + content tabs (Chat/Threads/Showcase/Resources/Events) | `chat:<id>` (`message`, `message-edit`, `message-delete`, `reaction-insert/update/delete`, `typing`); content tabs subscribe `threads:/events:/resources:<id>` via `useCommunityContent` | spinner (`:507-514`) | "Welcome to <community>" (`:563-580`) | plain error text **without retry** (`:516-520`) | `GET /api/communities/:id/messages` (page 50; `?before=`/`?after=`); `PATCH …/read`; `POST …/messages`; `POST …/messages/upload`; `PATCH …/messages/:mid`; `DELETE …/messages/:mid`; `POST …/messages/:mid/reactions` `{desiredEmoji}`; `GET /api/communities` (push deep-link resolution when route lacks params, `:96-109`) |
| `MA/app/settings/notifications.tsx` | Notification prefs (chat push on/off, sound, quiet hours + timezone, per-community mutes) + push diagnostics + local/server test pushes | none | spinner (`:175-178`) | "not in any communities yet" (`:276-279`) | tap-to-retry banner (`:184-194`) | `GET/PATCH /api/push/settings`; `GET /api/communities`; `POST /api/push/register` (retry, `:107-115`); `POST /api/push/test` (`:130-136`) |
| `MA/app/+not-found.tsx` | Static 404 | — | n/a | n/a | n/a | none |

### 1.2 Per-screen notes

**`app/(tabs)/index.tsx` (Home)**
- Keyset pagination: first page via `getHomeFeed()`, "load more" via `getHomeFeed(last.created_at)` on
  `onEndReached` threshold 0.4 (`:134-135`, `:71-87`); dedupes by `feedItemKind`+`id` (`MA/lib/homeFeed.ts:52-54`).
- Pull-to-refresh present with a real `refreshing` state (`:136-142`).
- Read-only: no edit/delete wired (`onEdit`/`onDelete` omitted, `:94-108`) — deliberate per header
  comment (`:26-28`).
- Cards open a `ContentDetail` modal (`:163-172`) and `CommentsSheet` (`:174-190`); card actions use
  optimistic `useContentActions` coalescer (`MA/components/community/contentView.tsx:132-249`).
- No realtime subscription: feed changes only on manual refresh/re-mount.

**`app/(tabs)/communities.tsx`**
- On press, passes community name/image/enabled tabs/showcase flag/owner/unread/last_read as **query
  params** to the chat route (`:26-51`) so the chat can draw its unread divider and tabs without a fetch.
- `markCommunityRead` is called on press (`:28`) and again inside the chat.
- Rows render typing dots + typed label (`MA/components/communities/CommunityRow.tsx`), last-message
  preview and last-reaction snippet driven by realtime patches in `useCommunities`.
- Pull-to-refresh calls `reload` but `RefreshControl` is hard-coded `refreshing={false}` (`:100-107`) —
  spinner never appears.
- Rough edge: error state never clears on a successful reload (see §8, issue 1).

**`app/community/[id].tsx` (chat)**
- Unread divider latched once from the first page using `last_read_at` + `unread_count` params
  (`:191-200`); day dividers interleaved (`:203-239`); "oldest history unknown" rule hides the first
  date pill until `hasMore` is false (`:216-219`).
- Pagination: `onEndReached` → `loadMore()` (older page via `?before=oldest`) with
  `maintainVisibleContentPosition` (`:532-536`).
- Optimistic send / cancel / retry / edit via `useSendMessage` (see §2).
- Reaction taps: local paint then server confirm, rollback on error (`:318-348`).
- Delete: optimistic soft-delete; failure swallowed ("Realtime UPDATE will reconcile", `:350-361`).
- Image lightbox: every loaded image, pinch/double-tap zoom, save to gallery, thumbnail strip
  (`MA/components/chat/ImageViewer.tsx`).
- iOS keyboard offset measured from header (`:626-663`); Android uses `react-native-keyboard-controller`
  height-resize (`:701-713`).
- `communityStore.activeCommunityId` set on mount / cleared on unmount (`:147-152`) so the list does not
  increment unread while reading.
- Content tabs mount `CommunityContentView` (`:717-722`) — Threads/Showcase/Resources/Events each fetch
  once via React Query (staleTime 20 s) + realtime invalidation + pull-to-refresh.

**`app/settings/notifications.tsx`**
- Four sections: Messages (chat push, sound), Quiet hours (start/end half-hour list sheet, device TZ sent
  with every quiet-hours save), Communities (per-community mute switches; list from `getCommunities()`,
  **archived communities are not filtered out**), "This device" diagnostics (permission, registration
  status, FCM token probe, Android channels, unread, Expo token, last error) + two test buttons.
- `getPushDiagnostics()` probes the raw device token with an 8 s timeout on every screen open
  (`MA/lib/push.ts:94-109`, `:136-173`), so opening the screen can hang ~8 s before diagnostics render.

---

## 2. Shared architecture

### 2.1 Core REST client — `MA/lib/api.ts`

| Export | Behavior |
|---|---|
| `API_BASE_URL` (`:20-21`) | `EXPO_PUBLIC_API_URL`, trailing slash stripped. Empty string when unset (requests go to relative path → fail). |
| `apiFetch<T>(path, {method, body, signal, headers})` (`:119-171`) | JSON fetch wrapper. Replays `Cookie: uxcommunity_session=<token>` read from AsyncStorage; captures `Set-Cookie` on every response (`:145-148`); selects JSON vs text by content-type; on `!ok` throws `Error` with `.status` and `.data` attached (`:158-168`). |
| `apiFormUpload<T>(path, formData, signal?)` (`:43-86`) | Multipart POST; does **not** set Content-Type so fetch adds the boundary; same cookie capture; same error shape. |
| `clearSession()` (`:89-94`) | Removes session + legacy session keys. |
| `getStoredSession()` (`:97-108`) | Reads new key, migrates legacy `@auth/draft_session`. |

Reusable capabilities for new features:

- **Auth for every request**: use `apiFetch`/`apiFormUpload` only — both replay the cookie; nothing else
  in the app calls `fetch` directly except the WebSocket.
- **Error normalization**: every failure is an `Error` whose `.message` is the server's `error` string (or
  `HTTP <status>`), plus `.status`/`.data`. No error classes, no `code` field.
- **Pagination helpers**: none generic — each caller builds its own (`?before` / `?after` in
  `MA/lib/communities.ts:116-129`, `?before` in `MA/lib/homeFeed.ts:44-49`, page loop in
  `getCommunityMembers` `MA/lib/communities.ts:214-228`).
- **Retry**: none built in. Retries are manual (message bubble Retry, screen Retry buttons).
- **Cancellation**: `AbortSignal` supported and passed through `apiFetch`/`apiFormUpload`, but only the
  message send/upload path actually uses it (`MA/hooks/useSendMessage.ts:117-142`).
- **Timeouts**: none. No `AbortSignal.timeout`, no request deadline anywhere.
- **401 handling**: none — an expired session just surfaces as a thrown error on each screen (see §8,
  issue 3).

### 2.2 Auth API — `MA/lib/auth.ts`

- `login(email, password)` (`:26-41`) → `POST /api/auth/login` `{email,password}`,
  reads `redirect === '/admin'`, then `GET /api/auth/me`; returns `{user, isAdmin}`.
- `logout()` (`:47-53`) → `POST /api/auth/logout` then `clearSession()` in `finally`.
- `getMe()` (`:59-62`) → `GET /api/auth/me` → `{user}`.
- `User` shape (`:7-14`): `id, name, email, role('user'|'admin'), profileComplete, avatar_url`.

### 2.3 Communities / chat REST — `MA/lib/communities.ts`

- `getCommunities()` (`:96-106`) — seeds `unread_count` from server `message_count` (server-computed
  unread) so badges are right on first paint.
- `getMessages(id, before?, after?)` (`:116-129`) — one page of 50; `before` = history, `after` = gap
  recovery (oldest-first).
- `sendMessage(id, {content?, reply_to_id?, image_url?, mentions?}, signal?)` (`:131-147`).
- `setMessageReaction(id, messageId, desiredEmoji|null)` (`:159-172`) — explicit desired state, not a
  toggle; returns authoritative grouped reactions.
- `markRead` PATCH (`:174-176`); `deleteMessage` DELETE (`:178-186`);
  `editMessage` PATCH (`:195-205`) → `{edited_at}`.
- `getCommunityMembers(id, max=200)` (`:214-228`) — pages the 30-row roster until `has_more` is false.
- `uploadChatImage(id, uri, mimeType, signal?)` (`:252-281`) — multipart `file` to
  `POST /api/communities/:id/messages/upload`; MIME normalisation (`image/jpg`→`image/jpeg`, `:235-242`).

### 2.4 Chat helpers (pure) — `MA/lib/chat.ts`

Web-parity ports, dependency-free: `MAX_MESSAGE_CHARS=500` (`:16`), `MESSAGE_EDIT_WINDOW_MS=15m` (`:19`),
`COLLAPSED_LINES=5` (`:22`), `fmtTime`/`fmtDate` (`:31`, `:38`), deterministic per-user name colours
(FNV-1a → 7-colour palettes, `:74-89`), `isEmojiOnly` (`:105`), `canEditMessage` (`:119`),
`extractFirstUrl` (`:132`), `detectMentionTrigger` / `findMentionOccurrence` / `resolveMentionsFromText` /
`splitContentByMentions` / `splitContentForRender` (`:195-353`), reaction projections
(`applyReactionInsert`/`Delete`, `projectOwnReaction`, `nextReactionIntent`, `:380-438`), and
`pickOptimisticMatch` (`:459-470`) for echo-vs-bubble pairing.

### 2.5 Comments — `MA/lib/comments.ts` + `MA/lib/commentText.ts`

- `getComments` / `postComment` / `deleteComment` / `toggleCommentReaction` against
  `/api/communities/:id/:kind/:targetId/comments[/:commentId[/reactions]]` (`:93-148`).
- `nestComments` (`:81-91`) normalises events' flat list; `sortComments` newest/popular at every level
  (`:189-208`); `COMMENT_MAX_LENGTH` per kind (`:65-70`); reactions allowed on all four kinds (`:60-62`).
- `commentText.ts`: `splitCommentText` (`:73`), `commentParticipantNames` (`:112`) — mention highlighting
  without Unicode property escapes on purpose (Hermes, `:18-19`).

### 2.6 Community content — `MA/lib/communityContent.ts`

- Types + labels for threads/showcase/events/resources; showcase categories (`:117-129`),
  `SHOWCASE_MEDIA_MAX=5` (`:132`).
- `getCommunityContent` (`:245-253`, response key differs per kind: `posts` for showcase, `:134-139`),
  `create` (`:255-265`), `update` (`:267-278`), `delete` (`:280-286`).
- `setContentAction` (`:301-340`) — explicit desired state; reconciles the four API shapes (showcase
  `{action,active}`, events `rsvp`, like/save/bookmark bodies and count keys differ).
- `getLinkPreviewImage` (`:342-347`); `uploadContentImage` (`:356-372`) — multipart `file` to
  `/api/communities/:id/:kind/upload`, returns `attachment` (or bare `url` for showcase).
- `communityStore.ts` (`:6-8`) — module-global `{ activeCommunityId }`, read by push handler and
  `useCommunities`, written by the chat screen.

### 2.7 Home feed — `MA/lib/homeFeed.ts`

- `getHomeFeed(before?)` (`:44-49`) — `GET /api/home/feed?before=<created_at>`;
  `hasMore = items.length >= 30` (`HOME_FEED_PAGE_SIZE`, `:17`); `feedItemKind`/`feedItemKey` map the
  `_type` discriminator (`:28-54`).

### 2.8 Realtime — `MA/lib/realtime.ts`, `realtimeCore.ts`, `realtimeCatchUp.ts`, `realtimeWindow.ts`

See §4.

### 2.9 Push — `MA/lib/push.ts` + `MA/lib/notificationSettings.ts`

See §3 (logout) and §4.9. Highlights: channels `messages` / `messages-silent` (`:39-41`, created at
`:233-259`), foreground presentation rules (`:192-216`), Expo token registration (`:267-346`),
`unregisterStoredPushTokenAsync` (`:447-459`), badge refresh on foreground (`:466-489`), server test
push (`:404-427`), diagnostics (`:136-173`). Notification settings API:
`fetchNotificationSettings` (`notificationSettings.ts:51-65`) also hydrates the muted list into the
non-React handler; `saveNotificationPreferences` partial PATCH (`:68-72`); `saveMutedCommunityIds`
(`:74-77`); `syncBadgeFromServer` (`:84-91`).

### 2.10 Media helpers

- `MA/lib/prepareImage.ts` — `prepareImageForUpload(asset, fallbackName)` (`:74-105`): WebP q0.90
  ≤2560 px (never upscaled) → JPEG fallback → original; constants `IMAGE_QUALITY`/`MAX_DIMENSION`
  (`:19-22`).
- `MA/lib/deviceMedia.ts` — `saveImageToGallery(url)` (`:43-63`): permission (write-only), download to
  cache, `MediaLibrary.saveToLibraryAsync`, best-effort cache delete; `fileNameForUrl` (`:19-29`).
- `MA/lib/profilePicture.ts` — `resolveProfilePictureUri` (`:10-16`): nulls out legacy generated-avatar
  URLs (dicebear/robohash/etc.) so initials fallbacks render.

### 2.11 Utility modules

- `MA/lib/nameCache.ts` — `createNameCache(max=500)` (`:32`, `:53-81`): LRU-on-write bounded map for
  resolved sender names.
- `MA/lib/booleanIntentCoalescer.ts` — `BooleanIntentCoalescer` (`:14-90`): one in-flight desired-state
  write, 120 ms quiet window, stale responses cannot overwrite newer intents; used by content cards.
- `MA/lib/haptics.ts` — `hapticImpact/Selection/Toggle/Success/Error` (`:31-75`): iOS generator styles
  vs Android `performAndroidHapticsAsync`, all fire-and-forget.
- `MA/lib/eventTimezone.ts` — curated zone table + `deviceTimeZone`, `canonicalZone`,
  `zoneOffsetMinutes`, `formatOffset`, `zoneLabel`, `timeZoneChoices`, `wallClockInZone`,
  `wallClockToIso`, `deviceOffsetMinutes`, `deviceClockReading` (`:116-326`); used by the event composer
  and `TimeZonePickerSheet`.

### 2.12 Context + hooks

| Module | Provides | Key behaviors |
|---|---|---|
| `MA/context/AuthContext.tsx` | `{user, isLoading, isAdmin, login, logout, refresh}` | Mount hydration `getMe` (`:73-84`); `refresh` re-reads `me` and resets realtime only when identity changed (`:59-70`) — **never called by any screen**; `login` destroys realtime first (`:86-92`); `logout` = destroy realtime → unregister push → `POST logout` → `setUser(null)` (`:94-104`) — **never called by any UI**. |
| `MA/hooks/useChatMessages.ts` | messages + `{isLoading, isLoadingMore, hasMore, error, reload, loadMore, appendMessage, updateReactions, softDeleteMessage, patchMessage}` | Initial page + `markRead` (`:60-73`); older-page pagination (`:75-89`); debounced single-flight `?after=` catch-up on reconnect & foreground (`:98-113`, `:384-394`); five realtime topics (`:176-377`); optimistic-echo pairing (`:196-257`). |
| `MA/hooks/useCommunities.ts` | list + `{markCommunityRead, clearActiveCommunity, getTypingLabel}` | Load + reconcile (max(server, local) unread, skips active community) (`:116-154`); bounded live-socket window (`:505-525`); per-community realtime topics incl. `typing` (`:194-485`); `markCommunityRead` also updates app badge (`:546-561`); `clearActiveCommunity` returned but unused. |
| `MA/hooks/useCommunityContent.ts` | React Query result for one tab (`communityContentKey`) | `staleTime 20 s` (`:47`); realtime rooms/topics map (`:20-33` — showcase deliberately absent); gap refetch on reconnect/foreground (`:59-92`, `:94-100`). |
| `MA/hooks/useSendMessage.ts` | `{handleSend, handleCancel, handleRetry, handleEdit, editSaving, editError, clearEditError}` | Optimistic bubble → upload image → POST; abort = cancel (text removed, image kept failed); retry re-runs full flow (`:72-229`); edit PATCH + local `edited_at` (`:236-262`). |
| `MA/hooks/useTypingPresence.ts` | `{typingUsers, typingLabel, onInputChange, stopTyping}` | Throttle 1 s, idle stop 1.6 s, remote expiry 3.5 s (`:21-23`); publishes `typing` on `chat:<id>` (`:112-125`). |
| `MA/hooks/usePushNotifications.ts` | side-effect hook mounted by `PushNotificationsBridge` | Handler once (`:28-30`); register once per user id (`:49-60`); badge + muted hydration on sign-in/foreground (`:64-67`); tap routing incl. cold start (`:70-90`). |
| `MA/hooks/useNotificationSettings.ts` | prefs + mutes + unread + `{reload, updatePreferences, updateQuietHours, setCommunityMuted, syncBadge}` | Optimistic writes with rollback (`:57-75`, `:84-106`); quiet hours always stamps device TZ (`:78-82`). |
| `MA/hooks/useMemberMentions.ts` | composer @-autocomplete | Module-level roster cache + inflight dedupe (`:29-52`); max 30 options, excludes self (`:94-101`); registry tracks only picked mentions (`:108-133`). |
| `MA/hooks/useColors.ts` | palette + `{scheme, isDark, deviceScheme, radius}` | Resolution: `override ?? EXPO_PUBLIC_COLOR_SCHEME ?? 'dark'` (`:24`); **device scheme is computed and returned but not used in resolution** (`:17`). |

### 2.13 Components (one line each)

| Component | What it does |
|---|---|
| `components/AppHeader.tsx` | Brand row (`BrandLogo` + wordmark), bell → `/settings/notifications` (`:47`), avatar with initials fallback; used by all four tabs. |
| `components/BrandLogo.tsx` | Pure `react-native-svg` logo (gradients, bubble glyph). |
| `components/ErrorBoundary.tsx` | Class error boundary around the whole app; renders `ErrorFallback`. |
| `components/ErrorFallback.tsx` | Full-screen crash UI; restart via `reloadAppAsync` (`expo`), dev-only raw error modal. |
| `components/KeyboardAwareScrollViewCompat.tsx` | Platform wrapper (RN ScrollView on web, `KeyboardAwareScrollView` elsewhere) — **currently imported nowhere**. |
| `components/PushNotificationsBridge.tsx` | Headless mount point calling `usePushNotifications()` inside `AuthProvider`. |
| `components/chat/ChatInput.tsx` | Composer: reply banner, image preview strip, link hint, @-mention suggestions, emoji panel toggle, gallery attach (lib picker only), 500-char limit + counter, send button. |
| `components/chat/MessageBubble.tsx` | WhatsApp-style bubble: tail, grouped author headers, reply quote, media with time overlay, mentions/links, Read-more, edited/time/status chrome, reaction pills, upload spinner + cancel, retry affordance, deleted state, big-emoji mode. |
| `components/chat/MessageBubbleTail.tsx` | SVG chat-tail (web port). |
| `components/chat/MessageActionsSheet.tsx` | Long-press sheet: 5 quick reactions (web order/colors), reply, copy, edit (15-min window), delete with confirm; `canModerate` for community owners. |
| `components/chat/EditMessageModal.tsx` | Edit composer with original-message quote, counter, saving spinner, error text. |
| `components/chat/EmojiPicker.tsx` | Inline emoji panel below composer (4 sections, ~200 emoji); parent-controlled open state. |
| `components/chat/ImageViewer.tsx` | Full-screen lightbox: sender header, caption, pinch/double-tap zoom, prev/next, thumbnail strip, save-to-gallery (`saveImageToGallery`). |
| `components/chat/MentionSuggestions.tsx` | Floating @-member list above the composer. |
| `components/chat/TypingIndicator.tsx` | Bouncing-dots pill + "X is typing…" label + stacked avatars. |
| `components/communities/CommunityRow.tsx` | List row: avatar/initials, name, preview text (typing > reaction > last message), time, unread badge, mute icon. |
| `components/community/CommentsSheet.tsx` | Full-page-sheet comment section for all four kinds: sort control, nested replies, mention highlighting, emoji reactions, reply composer with `@Name ` seed, delete confirm; reports live count to parent. |
| `components/community/CommunityContentEditor.tsx` | Create/edit modal for all four kinds: per-kind fields/validations, image upload (threads/showcase only, ≤5), event wall-clock + timezone picker, tags, public/replies switches. |
| `components/community/CommunityContentView.tsx` | A community tab: React Query list, cards, FAB create, editor/detail/comments wiring, delete via `Alert.alert`, pull-to-refresh. |
| `components/community/HeartIcon.tsx` | Shared like heart (SVG, like-pink fill, pop animation respecting reduced motion). |
| `components/community/TimeZonePickerSheet.tsx` | Bottom-sheet zone picker fed by `timeZoneChoices()`. |
| `components/community/contentView.tsx` | Shared card/detail/actions layer: `useContentActions` (coalesced optimistic likes/saves/RSVPs), `ContentCard`, `ContentDetail` modal, `ContentOptionsMenu`, `CollapsibleBody`, `MediaGrid`, `useResourcePreview` (module-level preview cache, `:255`). |

---

## 3. Auth & session

### 3.1 Mechanism (exact)

1. **Login**: `POST /api/auth/login` with `{email, password}` (`MA/lib/auth.ts:30-33`). The web API
   responds `{success, name?, redirect?}` and sets the `uxcommunity_session` HttpOnly JWT cookie.
   `apiFetch` reads the `Set-Cookie` header from the response and persists the value to
   AsyncStorage (`MA/lib/api.ts:28-36`, `:145-148`).
2. **Storage keys**: `@auth/uxcommunity_session` (`MA/lib/api.ts:16`); legacy key
   `@auth/draft_session` is read once and migrated (`:18`, `:97-108`). Realtime reads the same key
   directly (`MA/lib/realtime.ts:39`, `:62`).
3. **Replay**: every `apiFetch`/`apiFormUpload` sets `Cookie: uxcommunity_session=<token>`
   (`MA/lib/api.ts:130-134`, `:49-56`); the WebSocket handshake sends the same cookie in a header
   (`MA/lib/realtime.ts:61-64` → `realtimeCore.ts:128-133`).
4. **Hydration**: `AuthContext` calls `getMe()` on mount (`MA/context/AuthContext.tsx:73-84`);
   `app/index.tsx:22` redirects by `user`; `(auth)/_layout.tsx:8-10` bounces authenticated users to
   `(tabs)/communities`.
5. **Expiry handling**: **none beyond mount-time `getMe`**. A 401 from any later request just throws;
   `clearSession` runs only inside explicit `logout()` (`MA/lib/auth.ts:47-53`). `AuthContext.refresh`
   (`:59-70`) exists but has no caller. The JWT lives 7 days per the realtime comment
   (`MA/lib/realtime.ts:44-46`).
6. **Logout sequence** (implemented, unreachable from UI): `resetRealtimeSession()` →
   `unregisterStoredPushTokenAsync()` (`DELETE /api/push/register` while cookie still valid, then
   remove local token + clear badge) → `POST /api/auth/logout` → `clearSession()` →
   `setUser(null)` (`MA/context/AuthContext.tsx:94-104`, `MA/lib/auth.ts:47-53`,
   `MA/lib/push.ts:447-459`).
7. **Push token unregister order**: explicitly before cookie clear, per comment at
   `MA/context/AuthContext.tsx:99-101` — correct, but only reachable if `logout` is called.

### 3.2 Bugs / rough edges

- **No sign-out affordance anywhere.** `useAuth().logout` has zero call sites (verified by grep); no
  profile/settings screen exposes it. The only in-repo UI that can end a session is clearing app data.
- **Silent login failure path**: if `/api/auth/me` returns `{user: null}` right after a successful
  login (e.g. cookie not persisted), `login()` returns a null user and `AuthContext.login` sets
  `user = null` with no error (`MA/lib/auth.ts:37-40`, `MA/context/AuthContext.tsx:86-92`); the login
  screen just stops its spinner and nothing happens (`MA/app/(auth)/login.tsx:41-48`).
- **`isAdmin` is computed and exposed but consumed nowhere** (`MA/context/AuthContext.tsx:53,108`);
  admin members get the normal member UX.
- **Expired-session UX**: a user left on the chat/tabs after cookie expiry gets per-action error toasts
  at best (silent failures in several paths, e.g. `markRead` `.catch(() => {})` at
  `MA/hooks/useChatMessages.ts:259`), never a redirect to login, and their push token stays registered
  to the account until someone re-registers. There is no 401 interceptor in `api.ts`.
- **Cookie parsing is regex-fragile**: `new RegExp('uxcommunity_session=([^;]+)')` breaks on a
  `__Host-`/`Secure`-prefixed rename or a comma-joined multi-cookie header (`MA/lib/api.ts:30-33`).

---

## 4. Realtime layer

### 4.1 What exists

- Singleton `realtimeClient` (`MA/lib/realtime.ts:90-100`) built on `RealtimeClient`
  (`MA/lib/realtimeCore.ts:264`), a platform-free class: **one WebSocket per community room** plus
  **one multiplexed socket for all user-scoped rooms**, keyed `user:${userId}` (`:209-211`,
  `:735-740`).
- Rooms helper `realtimeRooms` (`:216-227`): `chat:`, `presence:`, `threads:`, `thread-comments:`,
  `events:`, `resources:`, `resource-comments:`, `showcase:`, `rules:`, `notifications:`.
  Community-prefix detection (`:169-183`) and user-room prefixes `notifications:`/`profile:` (`:189`).
- Rooms/topics used by the app **today**:
  - `chat:<communityId>` — `message`, `message-edit`, `message-delete`, `reaction-insert`,
    `reaction-update`, `reaction-delete` (`MA/hooks/useChatMessages.ts:177-377`); `typing`
    (`MA/hooks/useTypingPresence.ts:81-95`, published at `:112-125`). The community list also listens to
    the same six topics on its live-window sockets (`MA/hooks/useCommunities.ts:220-444`).
  - `threads:<id>` — `thread`, `like`, `save`; `events:<id>` — `event`, `rsvp`, `like`, `save`;
    `resources:<id>` — `resource`, `save` (`MA/hooks/useCommunityContent.ts:20-33`). Handlers simply
    invalidate the React Query cache.
  - `showcase` intentionally **not** subscribed (room is post-keyed on web, `useCommunityContent.ts:14-19`).
  - `rules:`, `*-comments:`, `presence:`, `notifications:`, `profile:` are defined in `realtimeRooms`
    but **no mobile code subscribes to them** (comments are pull-to-open only; no DM/notification list).

### 4.2 Subscription refcounting

- `on(room, topic, handler)` increments a per-topic refcount; the first handler sends `subscribe`;
  cleanup decrements and unsubscribes on the last (`realtimeCore.ts:800-851`).
- `subscribe(room)` is a room-level refcount (`:759-775`); presence handlers are a third refcount
  (`:860-884`). A room is removed only when all three are empty (`:1024-1033`), and a community socket
  closes only when no other room uses it (`:1035-1050`).
- `destroy()` (used by `resetRealtimeSession`, `realtime.ts:112-114`) closes everything, clears all
  tables, and bumps an internal session counter that renders every pre-logout cleanup closure inert
  (`realtimeCore.ts:283`, `:962-975`).
- Socket budget: the list keeps sockets for only the 10 most recently active communities
  (`realtimeWindow.ts:46`, `:57-72`); open screens always subscribe their own room regardless.

### 4.3 Liveness, reconnect, catch-up

- Heartbeat `ping` every 25 s / pong deadline 6 s (`realtimeCore.ts:146-148`, `:640-703`); failed pong
  recycles the half-open socket. AppState `active` probes every socket immediately (`realtime.ts:94-99`,
  `realtimeCore.ts:395-419`). Reconnect backoff 1 s → 15 s cap (`:143-144`, `:624-636`).
- Subscriptions are replayed from local refcounts on every open (`:712-732`); queued frames are capped at
  128 and subscription frames are dropped from the replay queue (`:162`, `:1155-1162`).
- **Catch-up contract**: `onRoomStatus(room, cb)` fires `true` on every open (first included) and
  `false` on drop (`:905-925`). Consumers:
  - `useChatMessages` → debounced single-flight `GET …?after=<newest real message>` and
    `mergeCaughtUpMessages` (`MA/lib/realtimeCatchUp.ts:57-106`, `:114-190`; wired at
    `useChatMessages.ts:384-394`).
  - `useCommunityContent` → React Query invalidate (debounce 500 ms, `:59-62,82-86`).
  - `useCommunities` → list reconcile (debounce 1000 ms, `useCommunities.ts:166-169`).

### 4.4 How a NEW feature (DM, notifications list) plugs in

1. If the room is user-scoped, name it `notifications:<userId>` (already in `USER_ROOM_PREFIXES`,
   `realtimeCore.ts:189`) — it will multiplex over the existing `user:${userId}` socket with no new
   socket. Community-scoped rooms need a new prefix in `COMMUNITY_ROOM_PREFIXES` (`:169-178`) if the
   feature is per-community.
2. In the feature hook: `realtimeClient.init({id, name, avatar})`, `connect(room)` (optional),
   `subscribe(room)`, then `realtimeClient.on(room, topic, handler)` per topic; register
   `onRoomStatus(room, connected => connected && catchUp())` and an `AppState` listener if the screen
   must recover gaps; return all cleanups from the effect (pattern:
   `useChatMessages.ts:154-402`).
3. Use `createCatchUpScheduler` + a merge helper (or React Query invalidate) for gap recovery; do not
   assume socket buffering.
4. Publish with `realtimeClient.publish(room, topic, data)` (`realtimeCore.ts:929-935`) — never call
   `destroy()`/`close()` from feature code; teardown is session-scoped.
5. Auth is automatic (handshake header read per open attempt, `realtime.ts:61-64`); no token plumbing
   needed.
6. `init()` re-keys/forgets user rooms on identity change; a brand-new user-scoped feature still gets
   the account-safety behaviour for free (`realtimeCore.ts:309-376`).

---

## 5. Uploads & media

### 5.1 Pipeline

```
expo-image-picker (library only)
  → prepareImageForUpload()  (expo-image-manipulator; WebP q0.90, ≤2560 px; JPEG → original fallback)
  → FormData with RN file descriptor {uri, type, name}
  → apiFormUpload()  (multipart POST, cookie replay, no Content-Type header)
  → server returns URL / attachment
```

### 5.2 Endpoints & callers

| Flow | Picker | Prepare | Upload endpoint | Response use |
|---|---|---|---|---|
| Chat image | `launchImageLibraryAsync` (`MA/components/chat/ChatInput.tsx:147-169`) | `prepareImageForUpload` (`ChatInput.tsx:163`) | `POST /api/communities/:id/messages/upload` (`MA/lib/communities.ts:252-281`) | CDN url → `sendMessage.image_url`; local URI kept on the optimistic bubble until echo (`useChatMessages.ts:34-37`, `:242-244`) |
| Thread/showcase image | `launchImageLibraryAsync` (`MA/components/community/CommunityContentEditor.tsx:134-163`) | `prepareImageForUpload` (`:151`) | `POST /api/communities/:id/:kind/upload` (`MA/lib/communityContent.ts:356-372`) | `attachment` appended to the draft; showcase cover = first image |
| Event/resource image | **not available** (`UPLOAD_KINDS = ['threads','showcase']`, `CommunityContentEditor.tsx:45`) | — | — | — |
| Comment image | **not implemented** (renders `image_url` if present, `CommentsSheet.tsx:783-784`, but no picker/upload) | — | — | — |
| Save received media | n/a | — | `FileSystem.downloadAsync` from CDN then `MediaLibrary.saveToLibraryAsync` (`MA/lib/deviceMedia.ts:43-63`) | gallery |

### 5.3 Properties

- **Multipart** everywhere (RN `{uri,type,name}` descriptor cast to `Blob`, `communities.ts:263-267`,
  `communityContent.ts:361-362`); no base64 paths in the app.
- **MIME normalisation** in both paths (`communities.ts:235-242`, `prepareImage.ts:38-43`).
- **Progress reporting: none.** `fetch` cannot report upload progress and no XHR/upload task is used;
  the chat bubble shows an indeterminate spinner + cancel button (`MessageBubble.tsx:623-637`).
- **Failure handling**: chat — bubble goes `failed`, tap Retry re-runs upload+send
  (`useSendMessage.ts:168-187`, `:216-229`); content editor — error string and the attachment is simply
  not added (no retry affordance) (`CommunityContentEditor.tsx:158-162`).
- **Cancellation**: chat only, via `AbortController` propagated to both upload and POST
  (`useSendMessage.ts:117-142`, `communities.ts:256, 140`).
- `launchCameraAsync` is not used anywhere — gallery only, both flows.

---

## 6. Styling & design system

### 6.1 Sources

- `MA/constants/designSystem.ts` — raw token source: Geist primitive scales (`:18-76`), semantic
  `lightTheme`/`darkTheme` (`:122-190`), `DEFAULT_COLOR_SCHEME = 'dark'` (`:201`), `radius`
  (`:206-214`), `shadows` (`:220-250`), `chatNameColors` per scheme (`:253-256`).
- `MA/constants/colors.ts` — builds a `Palette` per scheme: semantic names spread from the theme plus the
  legacy aliases (`card`, `primary`, `mutedForeground`, `subtle`, …) and chat tokens (`:64-107`).
  Header comment (`:12`): new tokens go in `designSystem.ts`, not here.
- `MA/hooks/useColors.ts` — the only sanctioned access path; returns `{...palette, scheme, isDark,
  deviceScheme, radius}`. **Resolution is dark-first**: `override ?? EXPO_PUBLIC_COLOR_SCHEME ??
  'dark'` (`:24`); the device colour scheme is read but unused, matching the web app's dark-only render
  (`designSystem.ts:196-201`).

### 6.2 Dark theme / fonts

- Dark palette: background `#09090B`, surface `#121214`, surfaceRaised `#1B1B1F`, foreground `#EDEDED`,
  accent `#FFFFFF` (accentForeground `#000000`), destructive `#E5484D`, like `#F91880`
  (`designSystem.ts:157-190`). Chat tokens: own bubble `#0062D1` white-on-blue, reaction pill `#2A2A2A`,
  7 rotating sender-name colours (`colors.ts:89-106`).
- Fonts: Geist only — `Geist_400Regular/500Medium/600SemiBold/700Bold` loaded in root layout
  (`MA/app/_layout.tsx:30-35`); Inter is a dependency but never loaded/used.
- Native chrome: `SystemUI.setBackgroundColorAsync(bg)` on scheme change (`_layout.tsx:39-41`); status
  bar style per screen from `colors.isDark`; splash/background `#09090B` (`app.json:11-14, 22`).

### 6.3 What a new screen should reuse

- `useColors()` for every colour; never literals (except deliberate platform chrome like the black
  reaction ring at `MessageBubble.tsx:126`, matching web).
- `AppHeader` for tab-level chrome; `StatusBar style={colors.isDark ? 'light' : 'dark'}` at screen top.
- List conventions: `FlatList` + stable keys; pull-to-refresh wired to a real `refreshing` state
  (Home's pattern, `index.tsx:136-142`); empty/error states as centred icon+title+body+action
  (Home's pattern, `index.tsx:119-159`).
- Buttons/tests: primary = `accent`/`accentForeground` (settings test button, `notifications.tsx:428-443`);
  segmented control (`notifications.tsx:658-705`); bottom-sheet pattern (`TimeSheet`,
  `notifications.tsx:737-798`); modal action sheet (options menu, `contentView.tsx:688-744`).
- Haptics vocabulary from `MA/lib/haptics.ts` for toggles/selections/destructive confirmations.
- Safe areas via `useSafeAreaInsets()` on every edge-to-edge screen (headers, sheets, FABs).

---

## 7. Test / tooling surface

### 7.1 Mobile package (`MA/package.json`)

Scripts: `start`, `android`, `ios`, `web` (Expo), `typecheck` (`tsc -p tsconfig.json --noEmit`, `:11`),
`doctor:push`, `sync:google-services` (`:12-13`). **No test script and no test runner dependency** —
devDeps are only `@babel/core`, `@expo/cli`, `@types/*`, `babel-preset-expo`, `typescript` (`:56-63`).
Deps: Expo 54 / RN 0.81.5 / React 19.1, `expo-router` 6, `@tanstack/react-query` 5, zod, reanimated 4,
keyboard-controller, svg, image, image-manipulator, image-picker, media-library, notifications, etc.
(`:15-55`). Note the stray dependency `"start": "^5.1.0"` (`:53`) — almost certainly accidental.

Configs: `tsconfig.json` extends `expo/tsconfig.base`, strict, `@/*` → app root; `babel.config.js` uses
`babel-preset-expo` with `unstable_transformImportMeta`; `metro.config.js` is the stock default;
`app.json` enables `typedRoutes`, `newArchEnabled`, dark `userInterfaceStyle`, EAS `projectId` in
`extra.eas` (`:59-67`).

### 7.2 Test files and how they run

Seven mobile test files exist, all `node:test` (`import { test } from "node:test"`), all in `MA/lib/`:

- `realtimeCore.test.ts` (socket lifecycle), `realtimeCatchUp.test.ts`, `realtimeWindow.test.ts`,
  `realtimeScale.test.ts` (real client vs fake platform, 1/10/50/100 memberships),
  `realtimeAuth.test.ts` (handshake header / no URL token), `nameCache.test.ts`, `eventTimezone.test.ts`.

Runners: **no vitest/jest config for the mobile app.** Root `package.json` scripts run them with
`tsx --test`:

- `test:mobile-realtime` → the five realtime suites (`package.json:95`)
- `test:mobile-cache` → `nameCache.test.ts` (`:96`)
- `test:event-timezone` → `eventTimezone.test.ts` (`:94`)

`vitest` 4.1.11 is in the root `node_modules` because it is a devDependency of **`apps/realtime`**
(`apps/realtime/vitest.config.ts`, script `"test": "vitest run"`) — completely separate from mobile.

### 7.3 CI (`.github/workflows/ci.yml`)

- Blocking jobs: web `tsc --noEmit` (`ci.yml:41-43`); web unit suite via `tsx --test` (`:61-66`);
  `npm run test:mobile-realtime` (`:72-73`); `npm run test:mobile-cache` (`:77-78`); comment audit;
  Vercel-drift audit; credential-guard tests. ESLint is advisory.
- **Not run in CI**: `test:event-timezone`, and the mobile `typecheck` script. `deploy.yml` /
  `preview.yml` contain no Expo/mobile steps (grep: only web/realtime deploys). Mobile releases are
  manual EAS/local-Gradle builds per `MA/README.md`.
- Root docs/tests references: `docs/mobile-architecture.md` names the realtime suites; `ci.yml:68-78`
  comments explain mobile is not an npm workspace so its suites are invoked explicitly.

### 7.4 Env surface

`eas.json` defines only `EXPO_PUBLIC_API_URL` for all three profiles (`eas.json:10-24`).
`EXPO_PUBLIC_REALTIME_URL` (required for realtime, `MA/lib/realtime.ts:12,38,49-52`) and
`EXPO_PUBLIC_COLOR_SCHEME` (`useColors.ts:18-22`) are **not** in `eas.json` or the README env section,
so EAS-built binaries only get realtime if the variable is set in the EAS project server-side
(unverifiable from the repo) — otherwise socket URLs build as `''` and realtime silently disables with a
console warning. A local, gitignored `.env` exists at `MA/.env` (location only; not read). A tracked
`MA/google-services.json` exists (Firebase config; contains keys — location only, values not read).

---

## 8. Verified gaps & bugs

### 8.1 Ranked list (severity: H = breaks a user flow / blocks parity work, M = degrades UX or misleads implementers, L = cosmetic/cleanup)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| 1 | **H** | **No sign-out UI.** `AuthContext.logout` (correct realtime destroy + push unregister + server logout) has zero call sites; no profile/settings screen exists. Users cannot switch accounts or release the device's push token. The push-unregister-on-logout flow documented in `docs/mobile-architecture.md:247-249` is dead code in practice. | `MA/context/AuthContext.tsx:94-104`; grep shows no `logout()` consumer |
| 2 | **H** | **Communities list error state can never recover.** `load()` sets `error` on failure but never clears it on success (`setError` only in the catch), and the screen renders the error branch whenever `error` is truthy. A failed first load + successful Retry/pull-to-refresh leaves the error screen forever (until remount). | `MA/hooks/useCommunities.ts:116-125`; `MA/app/(tabs)/communities.tsx:75-94` |
| 3 | **H** | **No session-expiry handling.** No 401 interceptor in `apiFetch`; `clearSession` is called only by explicit logout; `AuthContext.refresh` (the only path that could detect a dead session post-mount) is never invoked. An expired 7-day JWT leaves the member on broken screens with per-action failures, never a login redirect. | `MA/lib/api.ts:158-168`; `MA/lib/realtime.ts:44-46`; `MA/context/AuthContext.tsx:59-70` |
| 4 | **M** | **Docs claim the realtime JWT rides in `?token=` (and that RN cannot send WS headers) — the code does the opposite** (token-free URL; cookie in the handshake `Cookie` header via RN's third ctor arg). An implementer trusting the doc would re-introduce the credential-in-URL regression the code explicitly removed. | Drift: `docs/mobile-architecture.md:145-148, 157-158` vs `MA/lib/realtime.ts:41-64`, `MA/lib/realtimeCore.ts:49-55, 113-133` |
| 5 | **M** | **Design-system doc is stale.** `docs/mobile-design-system.md` documents an old palette (dark `background #000000`, `primary #0070F3`, `tint #52A8FF`, `destructive #EF4444`) and instructs "use `useColorScheme()` through the existing hook so light/dark mode follows the device setting" — the code is dark-only by default with an env override, and the real tokens live in `constants/designSystem.ts` (`#09090B`, accent `#FFFFFF`, `#E5484D`) not `colors.ts` alone. | Drift: `docs/mobile-design-system.md:12-17, 30, 46, 63` vs `MA/constants/designSystem.ts:157-201`, `MA/hooks/useColors.ts:16-24` |
| 6 | **M** | **`EXPO_PUBLIC_REALTIME_URL` missing from `eas.json`.** All EAS profiles define only `EXPO_PUBLIC_API_URL`; with the var absent, `buildSocketUrl` returns `''`, `openConnection` bails, and realtime is silently off (console warning only). Mobile built from eas.json relies on an unverifiable server-side EAS setting. | `MA/eas.json:6-26`; `MA/lib/realtime.ts:38,48-53`; `MA/lib/realtimeCore.ts:470-495` |
| 7 | **M** | **Chat load errors have no retry and pagination failures are silent.** The chat renders bare error text with no retry button (`useChatMessages.reload` is not even destructured), and `loadMore` swallows failures ("silent — user can scroll again"). Old history can end up permanently unreachable for a transient error. | `MA/app/community/[id].tsx:154-164, 516-520`; `MA/hooks/useChatMessages.ts:75-89` |
| 8 | **M** | **`eventTimezone.test.ts` is not run in CI** (only `test:mobile-realtime` + `test:mobile-cache` are); the mobile `typecheck` script is likewise not run by any workflow, so mobile type regressions are only caught locally. | `.github/workflows/ci.yml:61-78`; root `package.json:94-96`; `MA/package.json:11` |
| 9 | **M** | **Uploads have no progress and content-editor upload failures are one-shot.** Only an indeterminate spinner exists (chat) and the editor drops the attachment on failure with an error string, no retry; `fetch`-based uploads cannot report progress with the current client. | `MA/components/chat/MessageBubble.tsx:623-637`; `MA/lib/api.ts:43-86`; `MA/components/community/CommunityContentEditor.tsx:146-162` |
| 10 | **M** | **Pull-to-refresh on the communities list shows no spinner** (`refreshing={false}` hard-coded) and `reload()` provides no busy feedback; combined with #2 a user cannot tell a refresh happened or failed. | `MA/app/(tabs)/communities.tsx:100-107` |
| 11 | **L** | **`useColors` computes `deviceScheme` but ignores it** — the hook's own doc block says the device opts back in via env only, but design doc §1 says the opposite; dead read of `useColorScheme()` remains. | `MA/hooks/useColors.ts:17, 24` |
| 12 | **L** | **Dead / unused surface**: `KeyboardAwareScrollViewCompat` imported nowhere; `AuthContext.refresh`/`isAdmin` unconsumed; `useCommunities.clearActiveCommunity` returned but unused; `"start": "^5.1.0"` junk dependency; `packages/design-system` doc references vs local constants. | `MA/components/KeyboardAwareScrollViewCompat.tsx`; `MA/context/AuthContext.tsx:53,108`; `MA/hooks/useCommunities.ts:564-566`; `MA/package.json:53` |
| 13 | **L** | **Notification settings mute list includes archived communities** (uses `getCommunities()` without the `is_archived` filter the list screen applies); opening the screen also blocks on an up-to-8 s device-token probe before diagnostics render. | `MA/app/settings/notifications.tsx:83-89`; `MA/hooks/useCommunities.ts:584`; `MA/lib/push.ts:94-109` |
| 14 | **L** | **Silent login no-op path** (login succeeds, `getMe` returns null → spinner stops, nothing happens); `isAdmin` result discarded. | `MA/lib/auth.ts:37-40`; `MA/app/(auth)/login.tsx:41-48`; `MA/context/AuthContext.tsx:86-92` |
| 15 | **L** | **Event/resource/comment media gaps**: events/resources have no image upload in the composer (`UPLOAD_KINDS`, threads/showcase only); event comments support an `image_url` in the API/type but the composer has no picker; comment bodies for events are typed as optional-image in the lib comment but only text is implemented. | `MA/components/community/CommunityContentEditor.tsx:45`; `MA/components/community/CommentsSheet.tsx:783-784`; `MA/lib/comments.ts:10-14` |

### 8.2 Not in the app at all (absent screens/features)

- **Profile / account screen** (and therefore any sign-out, profile edit, avatar upload — `User.profileComplete` and `avatar_url` are read but never written by mobile code).
- **Direct messages (DM)** — the web repo has `apps/web/lib/direct-messages/*`; mobile has no DM routes, libs, rooms, or hooks. The realtime layer would support `notifications:<id>`-style user rooms but nothing subscribes.
- **Notifications list/inbox** — no screen, no `notifications:*` subscription, no unread inbox API usage.
- **Explore tab content** (search/discovery/company directory) — literal "coming soon" stub.
- **Jobs tab content** — literal "coming soon" stub.
- **Admin surfaces** (the web has an `/admin`; `login()` detects `redirect === '/admin'` and drops it).
- **Onboarding / signup / password reset** — login only.
- **Search** (communities, messages, members beyond the @-picker), **member/member-profile screens**, **event "going" list**, **purge/edit of comments by moderators** (owner-only chat delete exists), **video/GIF/document attachments**, **camera capture**, **share/export**, **pull-to-refresh in chat** and comments, **upload progress UI**, **i18n/localisation** (all strings hard-coded English), **offline cache / persisted query cache**, **app-level analytics/observability** (no logger SDK; only `console.warn/error`).
- **Push deep links beyond chat**: only `/community/<id>` is handled (`MA/hooks/usePushNotifications.ts:71-90`); e.g. a future DM/notification push payload would be ignored (`pushDataFrom` only accepts `type === 'community_message'`, `MA/lib/push.ts:219-227`).

### 8.3 Capability matrix

| Capability | Present? | Where | Notes |
|---|---|---|---|
| Token auth (cookie-as-token) | Yes | `MA/lib/api.ts:28-36, 119-171` | HttpOnly JWT captured from `Set-Cookie`, replayed as `Cookie` header; regex-fragile (§3.2). |
| Cookie replay (WS handshake) | Yes | `MA/lib/realtime.ts:61-64`; `realtimeCore.ts:128-133` | `Cookie` header via RN WS third ctor arg; URL stays token-free (docs drift, §8.1-4). |
| Logout cleanup | Partial | `MA/context/AuthContext.tsx:94-104`; `MA/lib/push.ts:447-459`; `realtimeCore.ts:962-975` | Fully implemented **but unreachable** (no UI caller). |
| Refresh (session refresh) | No | `MA/context/AuthContext.tsx:59-70` | `refresh()` exists, never called; no token renewal mechanism (7-day cookie only). |
| Pagination (any list) | Yes | `communities.ts:116-129` (`before`/`after`), `homeFeed.ts:44-49` (`before`), `communities.ts:214-228` (page loop) | Chat + Home feed only; content tabs/comments fetch one page. |
| Pull-to-refresh | Yes (3 screens) | Home `index.tsx:136-142`; Community tabs `CommunityContentView.tsx:115-121`; Communities list `communities.tsx:100-107` (spinner broken) | Chat, comments sheet, notifications settings have none. |
| Infinite scroll | Yes (2 screens) | Home `index.tsx:134-135`; chat older-history `community/[id].tsx:535-536` | Chat list is chronological — `onEndReached` loads *older* pages upward. |
| Error normalization | Partial | `MA/lib/api.ts:158-168` | `Error` + `.status` + `.data`; message = server `error` or `HTTP <n>`; no codes/classes; no 401 special-case. |
| Retry | Manual only | `useSendMessage.ts:216-229`; screen Retry buttons (`communities.tsx:78-80`, `index.tsx:124-126`, `ContentView.tsx:90-92`) | No automatic retry; no backoff outside realtime reconnect. |
| Cancellation | Partial | `apiFetch`/`apiFormUpload` accept `AbortSignal`; used only by send/upload (`useSendMessage.ts:117-142`) | No cancellation for feeds/comments/pagination. |
| Timeouts | No | — | No request deadlines anywhere; only the push device-token probe has an 8 s race (`push.ts:94-109`). |
| Upload progress | No | — | Indeterminate spinner only (`MessageBubble.tsx:623-637`). |
| Optimistic updates | Yes | Sends `useSendMessage.ts:83-114`; chat reactions `community/[id].tsx:316-348`; content actions `contentView.tsx:132-249` + `booleanIntentCoalescer.ts`; comment reactions `CommentsSheet.tsx:663+`; prefs/mutes rollback `useNotificationSettings.ts:57-106`; soft-delete `useChatMessages.ts:131-146` | Echo/retry reconciliation via `pickOptimisticMatch` + `mergeCaughtUpMessages`. |
| Realtime cleanup | Yes | `realtimeCore.ts:759-851, 1024-1050, 962-975`; `realtime.ts:112-114` | Refcounts + session-counter inert closures; exercised by `realtimeScale.test.ts`. |
| Push deep links | Partial | `usePushNotifications.ts:70-90`; `push.ts:219-227` | Only `community_message` → `/community/<id>`; cold-start handled. |
| Dark theme | Yes (dark-default) | `designSystem.ts:201`; `useColors.ts:24`; `app.json:9` (`userInterfaceStyle: dark`) | Light palette exists but only via `EXPO_PUBLIC_COLOR_SCHEME=light`; device scheme ignored. |
| i18n | No | — | All UI strings hard-coded `en-US`; date helpers hard-code locale (`chat.ts:26-27`). |

---

## Appendix A — Documentation drift summary

| Doc claim | Reality |
|---|---|
| `docs/mobile-architecture.md:145-148` emits `wss://…/ws?room=<room>&token=<jwt>`; `:157-158` "session JWT goes in the `token` query parameter, because React Native's WebSocket API cannot send custom headers" | Token-free URL; cookie sent via handshake header (`MA/lib/realtime.ts:41-64`; `MA/lib/realtimeCore.ts:113-133`, which documents why RN WS headers work). |
| `docs/mobile-architecture.md:247-249` push unregister on logout "before the session cookie is cleared" | Implemented and ordered correctly, but no UI calls `logout` (§8.1-1). |
| `docs/mobile-design-system.md:12-13` theme source `constants/colors.ts`; `:17` "light/dark follows the device setting"; §2 old palette values (`:30, :46, :63`, …) | Actual token source is `constants/designSystem.ts` (colors.ts delegates, `colors.ts:15-22`); dark-only default (`useColors.ts:24`); current values differ (#09090B bg, #FFFFFF accent, #E5484D destructive). |
| `docs/mobile-design-system.md:166-169` "Tabs: home/community feed, explore, communities, and jobs" | Explore and Jobs are "coming soon" stubs (`explore.tsx:15`, `jobs.tsx:15`). |
| `MA/README.md:33-34` env instructions list only `EXPO_PUBLIC_API_URL` | `EXPO_PUBLIC_REALTIME_URL` is also required for realtime (`MA/lib/realtime.ts:12`) and is absent from README + eas.json (§8.1-6). |

## Appendix B — Secrets handling

Per audit rules, no secret values were read or copied. Locations only:

- `MA/.env` — local, gitignored (Expo public env vars).
- `MA/google-services.json` — **tracked in git** (Firebase Android config; contains API keys).
- `MA/app.json` + `MA/eas.json` — EAS `projectId` (non-secret identifier) is embedded.
