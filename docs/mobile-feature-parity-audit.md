# Mobile feature parity audit

Web (`apps/web`) → mobile (`expo-app-standalone 3/`) parity audit and implementation
record, for branch `feat/mobile-parity` (2026-10-16).

The web application is the functional source of truth. Every rule below was read out of
shipped code — route handlers, server libraries and SQL migrations — not inferred from
route names. The per-domain detail lives in the appendices (also produced by this audit):

| Appendix | Covers |
|---|---|
| [mobile-parity-notes/web-auth-accounts.md](mobile-parity-notes/web-auth-accounts.md) | Signup/OTP, login, reset, sessions, middleware, profile & settings, deletion |
| [mobile-parity-notes/web-feed-content.md](mobile-parity-notes/web-feed-content.md) | Home feed scopes, posts, comments, saves/bookmarks, search, threads/resources/showcase, library |
| [mobile-parity-notes/web-communities-dm-notifications.md](mobile-parity-notes/web-communities-dm-notifications.md) | Explore/join/requests, roles & moderation, chat, mute, read state, **DM (full contracts)**, notifications, push |
| [mobile-parity-notes/web-jobs-events-companies.md](mobile-parity-notes/web-jobs-events-companies.md) | Jobs (board/detail/apply/post/manage/applicants/triage), events, companies & verification, invites |
| [mobile-parity-notes/mobile-current-state.md](mobile-parity-notes/mobile-current-state.md) | The mobile app as found (screens, capabilities, bugs, docs drift) |

---

## A. Feature comparison matrix

Status vocabulary: **Verified** (implemented this branch, typecheck/test/bundle checked);
**Already implemented** (existed before, verified on this branch); **Partial** (a working
slice shipped, remainder in §E); **Missing — planned** (not in this branch, next steps in
§E); **Web-only by design** (intentionally not ported).

### Authentication & accounts

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Login (member) | `POST /api/auth/login`, 401 generic / 403 blocked | Exists (`app/(auth)/login.tsx`) | 401/429 handling | P1 | Already implemented; `Retry-After` copy still generic |
| Logout | `POST /api/auth/logout` (`lib/auth.ts:47`) | Teardown existed, **no UI called it** | Sign-out entry | P1 | **Verified** — settings hub (avatar → `app/settings/index.tsx`); logout now clears local session even offline |
| Session persistence | HttpOnly JWT cookie, 7-day fixed, no refresh | Cookie capture/replay over fetch | — | P1 | Already implemented |
| Session expiry | `/me` → 200 `{user:null}`; other APIs 401 | **No 401 handling** — expired session = dead screens | 401 interceptor + redirect | P1 | **Verified** — `lib/api.ts` clears + signals, `AuthContext` signs out, root `SessionGate` redirects to login |
| Signup (3-step, no email verify) | `/signup` + RPC `complete_signup`, `signup_attempts` funnel, invitation tokens | Absent | Whole flow | P1 (blocked on deletion policy) | Missing — planned (§E1) |
| Forgot/reset password | `/forgot-password`, `/reset-password` (+ OTP states) | Absent | Whole flow | P2 | Missing — planned |
| Profile completion / onboarding | redirects + `profileComplete` flag | Flag read at login; no completion UI | Completion screens | P2 | Missing — planned |
| Account deletion | Admin-only `DELETE /api/admin/users/[id]`; **no self-serve endpoint** | Absent | Endpoint + screen (App Store 5.1.1(v) if mobile signs users up) | P1 decision | Blocked — §E1 |

### Home feed & posts

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Home feed scopes | `/api/home/feed?scope=public\|communities` (disjoint; `all` = legacy) | Feed fetched with no scope (legacy `all`) | Scope param + tabs + persistence | P1 | **Verified** — Home tab chips "Public Posts"/"Your Communities", stored choice, legacy `all`→default |
| Feed cards & pagination | Keyset `?before=created_at`, 30/page | Exists (same endpoint) | — | P1 | Already implemented (cards shared with community tabs) |
| Post creation/edit/delete | Community composer routes (member-gated) | Exists inside community tabs | — | P1 | Already implemented |
| Likes / comments / replies | Comment routes; 1-level nesting; author-only delete; no edit | Exists (CommentsSheet) | — | P1 | Already implemented |
| Save vs like semantics | `resource_saves` = heart/Like; `resource_bookmarks` = ••• Save; Saved page reads the bookmark | Card actions exist | — | P1 | Already implemented (verified against migration `20261015160000`) |
| Saved page | `/dashboard/saved` → `GET /api/profile/feed?scope=saved` | Absent | Whole screen | P1 | **Verified** — header bookmark → `app/saved.tsx`, focus refresh |
| Reports | `POST /api/content-reports` (8 reasons, self 403, dup 409) | Absent | Report entry on cards | P2 | Missing — planned |
| Poll voting | `POST …/poll` one-time undo | Absent (composer parity) | Poll UI | P2 | Missing — planned |
| Search palette | Client-side across 9 pages + joined communities | Absent | Command palette | P2 | Missing — planned |

### Communities

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Communities list (joined) | Sidebar + `/dashboard/communities` | Exists, realtime previews | — | P1 | Already implemented |
| Explore/browse | `GET /api/communities/all` + client tabs (All/Public/Private/Requests sent), profile-mirror rows hidden | **Stub screen** | Whole screen | P1 | **Verified** — `app/(tabs)/explore.tsx` with the same filter rules + recommended/rest split |
| Public join | `POST /api/communities/[id]/join` | Absent | Join action + errors | P1 | **Verified** (in Explore) |
| Private join request + withdraw | Same endpoint; `DELETE` withdraws | Absent | Request modal (≤500 msg) + withdraw | P1 | **Verified** (in Explore, "Requests sent" tab) |
| Community preview for non-members | `/api/communities/[id]/preview` | Absent | Preview screen | P2 | Missing — planned (Explore cards act inline instead) |
| Mute (8h/1w/Always) | `POST /api/communities/[id]/mute` | Absent | Bell menu in chat | P1 | Missing — planned |
| Read state / unread counts | `PATCH …/read` + read-manager | Exists | — | P1 | Already implemented |
| Tab red-dot watermarks | localStorage watermarks; members dot = pending requests | Absent | AsyncStorage port + fetches | P2 | Missing — planned |
| Join-requests inbox (manager) | `GET …/requests`, accept/decline | Absent | Manager UI | P1 | Missing — planned (§E2) |
| Members list / remove / roles | Members tab APIs | Partially (members list call exists) | Management UI | P2 | Missing — planned |
| Edit/delete community, rules panel | PATCH multipart, rules JSON | Absent | Settings UI | P2 | Missing — planned |
| Invite links | `/join/[token]` + APIs | Absent | Deep link + accept | P2 | Missing — planned |
| Leave community | `DELETE …/members` (ownership transfer variants) | Absent | Leave action | P2 | Missing — planned |

### Community chat

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Send/edit/delete/reactions/typing | Chat routes + `chat:<id>` realtime | Exists (rich) | — | P1 | Already implemented |
| 15-day retention | sweep + `messages-expired` topic | Not surfaced | Notice + prune on event | P3 | Missing — planned |
| Attachments / image upload | Upload route | Exists (chat images only) | Video/docs | P2 | Partial |

### Direct messages

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Conversation list | `GET /api/dm/conversations` (people-count unread, request labels) | Absent | Whole screen (+ `dm:` room prefix in the realtime client) | P1 | **Verified** — `app/messages/index.tsx`, realtime + focus refresh; `realtimeCore` now knows `dm:` |
| Thread (read/send) | `GET/POST …/messages`; nonce idempotency; request gates | Absent | Whole screen | P1 | **Verified** — `app/messages/[id].tsx`; optimistic sends confirmed by id/nonce, throttled read markers |
| Request accept/reject | `POST …/request` (+ implicit accept on reply) | Absent | Accept/Reject footer | P1 | **Verified** |
| One-message cap | DB trigger + pre-send gates | Absent | Composer states + server copy | P1 | **Verified** — hint, outgoing/incoming states, declined notice |
| Unread badge | `GET /api/dm/unread` + `dm-message` refetch | Absent | Header envelope badge | P1 | **Verified** — `useDmUnread` (people-count, active-thread suppression) |
| `?peer=` get-or-create | `POST /api/dm/conversations` | Absent; **no member entry point exists on mobile at all** | Member profile/picker needed | P1 | Partial — receiving/replying/accepting work; starting a new conversation waits on §E2 (member profiles) |
| Typing | REST relay `dm-typing` | Absent | Pulse send + display | P2 | Missing — planned |
| Edit/delete/reactions (UI actions) | Message routes + topics | Read-side echo handling exists | Author actions UI | P2 | Partial |
| Blocks + reports | `/api/dm/blocks`, `/api/dm/reports`; reduced profile view | Absent | Menus + reduced views | P2 | Missing — planned (unblock button exists on the blocked footer) |

### Notifications & push

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Notifications inbox | `/dashboard/notifications`, 4 tabs, realtime `notifications:<uid>` | Absent (settings only) | Whole screen | P1 | **Verified** — `app/notifications.tsx`, 16 types mapped, optimistic marks |
| Seen watermark badge | localStorage watermark; opening clears without marking read | Absent | AsyncStorage store shared bell↔screen + page-cache patch | P1 | **Verified** — red count chip on the header bell, 99+ cap |
| Mark read / mark all | `PATCH /api/notifications` | Absent | Optimistic + realtime echo dedupe | P1 | **Verified** |
| Notification preferences | `GET/PATCH /api/push/settings` | Exists (settings screen) | — | P1 | Already implemented |
| Push registration + tap routing | Expo push, `community_message` payload | Exists (chat-only deep link) | Non-chat payload routing | P2 | Already implemented (chat); other types land in the inbox-linked screens |
| EAS production realtime | — | `EXPO_PUBLIC_REALTIME_URL` **missing from eas.json** (production builds had no realtime) | Add to all profiles | P1 | **Verified** — all three EAS profiles carry `https://rt.uxcommunity.in` |

### Profiles & professional identity

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Own profile page (view + activity) | `/dashboard/profile` + `/api/profile/feed` | Absent | Whole screen | P1 | Missing — planned (§E2) |
| Member profile | `/dashboard/profile/[userId]` | Absent | Whole screen; also the DM entry point | P2 | Missing — planned |
| Profile edit (name/bio/links; 3-month identity cooldowns) | `/api/profile`, `/api/profile/identity` | Absent | Edit screens + cooldown copy | P2 | Missing — planned |
| Avatar upload | R2, magic-byte checks, 3/5 MB caps, 400 px convention | `prepareImage.ts` exists (2560 cap) | Wire to profile edit (pass 400 px cap) | P2 | Missing — planned |
| Settings hub | Sidebar → `/dashboard/settings/*` | Absent | Hub | P1 | **Partial** — hub ships with Notifications + Sign out; Account/Email/Job profile next (§E2) |
| Work-email OTP verification + company display | `/api/companies/verifications*`, domain rules | Absent | Whole flow | P2 | Missing — planned |
| Company directory search / page | `GET /api/companies/search`; page is RPC-only (**no JSON route**) | Absent | Screen + a new JSON route | P3 | Missing — planned |

### Jobs

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Board (tabs, search, cursor) | `/dashboard/jobs`; `GET /api/jobs/feed`; browse tabs show `can_apply` only | **Stub screen** | Whole screen | P1 | **Verified** — `app/(tabs)/jobs.tsx`, same tab predicates, 50/page cursor, client search |
| Detail | RPC `get_job_detail`; **no JSON route existed** | Absent | Route + screen | P1 | **Verified** — new `GET /api/jobs/[id]` (server) + `app/jobs/[id].tsx` with locked/applied/closed states |
| Apply (multipart, resume) | `POST /api/jobs/[id]/apply` | Absent | Sheet + upload | P1 | **Verified** — `ApplySheet` (name/portfolio/LinkedIn, saved resume or picked file via expo-document-picker, server copy on failures) |
| Eligibility rule | SQL: title+level exact; city/sector unless NULL wildcard | Absent | Server authority + client lock copy | P1 | **Verified** — `can_apply` drives everything; `criteriaMismatches` only names dimensions |
| Saved resumes | `GET/POST/PATCH/DELETE /api/settings/resumes` | Absent | Picker read side shipped | P2 | Partial — list readable/selectable in Apply; managing (add/delete/default) next |
| Post a job | `POST /api/jobs` (verified company required, 1/month) | Absent | Form + company verification dependency | P1 | Missing — planned (§E3) |
| My posts management | edit/close/reopen/delete routes | Absent | Owner menu | P2 | Missing — planned |
| Applicants board + triage | RPC-only (**no JSON route**) | Absent | Route + screens | P2 | Missing — planned |
| Design-mode viewer | `/applications/…` web experiment (iframe/pdf.js) | Absent | — | — | Web-only by design (data surface covered when the board ships) |

### Events

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| City browse | `GET /api/events/city` (viewer's own city, cursor, filters) | Absent | Whole screen | P1 | Missing — planned (§E4) |
| Event detail | `GET /api/communities/[id]/events/[eventId]` | Absent | Whole screen | P1 | Missing — planned |
| RSVP (join/leave, capacity) | `POST …/rsvp` (toggle; join also joins the event room) | Absent | Action + states | P1 | Missing — planned |
| Event room (group chat) | room created on demand, `is_private:false`, chat-only | Chat exists; room joining absent | Join door + info card | P2 | Missing — planned |
| Create/edit/delete event | community-member routes; 1/month; cover upload | Absent | Forms | P2 | Missing — planned |
| Like/save/comments on events | card routes | Partially (feed cards) | — | P3 | Partial |

### Library, admin, misc

| Feature | Web implementation | Mobile status before | Gap | Priority | Final status |
|---|---|---|---|---|---|
| Library shelf | `/dashboard/library` (curated, read-only) | Absent | Whole screen | P2 | Missing — planned |
| Global search | Client-side palette | Absent | — | P2 | Missing — planned |
| Admin/moderation consoles | `/admin/*` | Absent | — | — | Web-only by design (back-office) |
| Community message push | server-side fan-out, `community_message` | Exists | — | P1 | Already implemented |
| Join-accepted push | `membership-<cid>` collapseId | Notification renders in inbox; push deep-link generic | Route to community | P3 | Partial |

---

## B. Business-rule checklist (the important conditions, as implemented)

| Rule (web authority) | Mobile implementation | Verified by |
|---|---|---|
| Session = 7-day HS256 cookie; `/me` answers 200 `{user:null}` when expired; other APIs 401 | Cookie replay via `Cookie:` header; 401 on a stored session clears it and signs out; `SessionGate` redirects | `lib/api.ts`, `context/AuthContext.tsx`; typecheck + code review (live expiry replay untested) |
| Logout is stateless (no revocation) | Local session always cleared, server call best-effort | `AuthContext.logout` |
| Bell badge = unread **created after the last-open watermark**, monotonic; opening clears without marking read; no watermark ⇒ server unread total | `createSeenStore` (AsyncStorage, monotonic, hydrate-once), `autoMarkSeen` on the screen, badge falls back to server unread only before hydration | `lib/notifications.test.ts` (16 cases), `hooks/useNotifications.ts` |
| Mark-read echo must not double-decrement | Atomic single-state updates: decrement only when the local copy was still unread | `useNotifications` update/delete handlers |
| Notification tab split (16 types → 4 tabs; unclaimed types invisible) | Ported verbatim; job_match rows show "View job" | `notifications.test.ts` |
| Feed scopes are disjoint; `all` is legacy; stored `all` → default | Chips + persisted scope; legacy normalization | `homeFeedScopes.test.ts` (3 cases) |
| `resource_saves` = heart; `resource_bookmarks` = Save; Saved reads bookmarks | Saved screen uses `scope=saved`; card semantics unchanged | feed appendix §business rules 3; live API shape |
| Explore hides joined + profile-mirror rows; "Requests sent" is its own list; search = name substring | Ported verbatim (`visibleExploreRows`) | `explore.test.ts` (7 cases) |
| Join: public = immediate; private = pending request; declined rows deleted for re-request; caps 7 (pending holds a slot); PROFILE_MISMATCH 403 with pointer copy | Same endpoint branching on `status`; server error copy surfaced; local row patch on success | `lib/exploreApi.ts`; error bodies read from `join/route.ts` |
| Jobs browse tabs show only `can_apply`; own → My posts; applied → Applied; closed/expired visible only to owner | Same predicates over loaded pages (`splitJobsByTab`) | `jobs.test.ts` (11 cases) |
| Eligibility = title+level exact, city/sector unless NULL wildcard; server is the authority | `can_apply` gates everything; client never computes permission | job RPC cited in appendix; screen copy |
| Apply = multipart, resume required (≤5 MB, PDF/DOC/DOCX/RTF magic-byte), nonce-free but transaction-safe; failures mapped to copy | `apiFormUpload` FormData; client pre-checks are advisory; server messages shown verbatim | `lib/jobsApi.ts`, `resumeFileIssue` tests |
| DM request cap: first message becomes the request; requester holds exactly one message until a reply (implicit accept); reject closes both sides; block refuses both directions | Composer state machine ported; server copy on 403; blocked footer + unblock | `dm.test.ts` (10 cases), route gates cited in appendix |
| DM unread badge = conversations with unread (people-count) | `useDmUnread` with `dm-message` refetch (600 ms debounce) and active-thread suppression | code + payload shapes read from publish code |
| Realtime: `notifications:`, `dm:`, `profile:` ride the one `user:<uid>` socket; community rooms are per-community sockets | `USER_ROOM_PREFIXES` now includes `dm:`; notifications + DM hooks init identity before subscribing | `test:mobile-realtime` (56 cases) still green |
| Home feed has **no realtime** — refetch on remount/hidden-return | Mobile refetches on scope switch/pull/foreground; no sockets | feed appendix §rule 8 |
| Push deep links carry only ids; screens resolve display data | Community screen already resolves; notification links pass `?tab=` | `app/community/[id].tsx` |
| Every write route re-checks liveness/membership server-side | Client mirrors gates for copy only | audit appendix, unchanged server authority |

---

## C. API and data-flow mapping

No new backend, no new tables. One server addition; everything else reuses the web contracts.

| Feature (mobile) | API used | Auth | Realtime | Data |
|---|---|---|---|---|
| Notifications inbox + badge | `GET/PATCH /api/notifications` | session cookie | `notifications:<uid>` insert/update/delete | `notifications` table (+ RPC `create_notification` server-side) |
| Jobs board | `GET /api/jobs/feed?before=` | session | none (refetch) | RPC `get_job_feed`, `job_posts`+`job_applications` |
| Job detail | **`GET /api/jobs/[id]` (added this branch)** | session | none | RPC `get_job_detail` / `job_post_payload`, formatted with `formatJobFeedRows` |
| Apply | `POST /api/jobs/[id]/apply` (multipart) | session | none | RPC `apply_to_job`; R2 `resumes/<uid>/…`; `member_resumes` adoption |
| Saved resumes (read) | `GET /api/settings/resumes` | session | none | `member_resumes` + R2 |
| Explore | `GET /api/communities/all` | session | none | RPC `get_all_communities` |
| Join / request / withdraw | `POST|DELETE /api/communities/[id]/join` | session | none | `community_members`, `community_join_requests`, `creation_limits` trigger |
| Home feed scopes | `GET /api/home/feed?scope=&before=` | session | none | RPC `get_home_feed_page` |
| Saved | `GET /api/profile/feed?scope=saved&before=` | session | none | RPC `get_profile_feed_page` |
| DM list | `GET /api/dm/conversations` | session | `dm:<uid>` `dm-message`, `dm-request-update` | RPC `get_dm_conversations` |
| DM thread | `GET/POST /api/dm/conversations/[id]/messages` | session | same room; edit/delete topics handled | RPC `get_dm_message_page`; `dm_messages` (+ nonce unique) |
| DM answer / read / unread | `POST …/request`, `PATCH …/read`, `GET /api/dm/unread` | session | `dm-request-update` publish | RPCs `mark_dm_conversation_read`, `get_dm_unread_total` |
| Bell/screen deep links | — | — | — | web `href` → mobile route map (`notificationRouteFor`) |

---

## D. Implementation record

### Commits (branch `feat/mobile-parity`, based on `main` @ fdc07846)

| Commit | Contents |
|---|---|
| `eec873a2` | Notifications inbox + badge + seen watermark; settings hub + sign-out; 401 session-lost handling + SessionGate; jobs board, detail, apply; audit fixes (communities error state, pull-to-refresh spinner, `dm:` room prefix, EAS realtime env, `?tab=` deep links); **server**: `GET /api/jobs/[id]` |
| `ef8c4949` | Explore browse + join requests + withdraw; home feed scope tabs + persistence; Saved screen; DM list + thread + request accept/reject + unread badge + realtime; communities focus-refresh |

### New mobile files

- `app/notifications.tsx`, `app/saved.tsx`, `app/settings/index.tsx`, `app/jobs/[id].tsx`, `app/messages/index.tsx`, `app/messages/[id].tsx`
- `components/jobs/JobCard.tsx`, `components/jobs/ApplySheet.tsx`
- `hooks/useNotifications.ts`, `hooks/useDmUnread.ts`
- `lib/notifications.ts` (+`Api`,`Seen`), `lib/jobs.ts` (+`Api`), `lib/explore.ts` (+`Api`), `lib/dm.ts` (+`Api`), `lib/homeFeedScopes.ts`
- Tests: `lib/notifications.test.ts` (16), `lib/jobs.test.ts` (11), `lib/explore.test.ts` (7), `lib/homeFeedScopes.test.ts` (3), `lib/dm.test.ts` (10)

### Changed mobile files (selection)

- `lib/api.ts` (401 session-lost signal), `context/AuthContext.tsx` (offline-safe logout, session-lost), `app/_layout.tsx` (SessionGate, new routes), `components/AppHeader.tsx` (bell + envelope badges, saved), `lib/realtimeCore.ts` (`dm:` prefix + room), `lib/homeFeed.ts` (scope + saved), `app/(tabs)/index.tsx` (scope chips), `app/(tabs)/communities.tsx` + `hooks/useCommunities.ts` (error clear, focus refresh), `app/community/[id].tsx` (`?tab=`), `eas.json` (realtime URL), `package.json` (test scripts)

### Web files changed

- `apps/web/app/api/jobs/[id]/route.ts` — added `GET` (the JSON single-job read; same RPC + formatter as the feed)

### Docs

- `docs/mobile-feature-parity-audit.md` (this file) + `docs/mobile-parity-notes/` (five domain appendices)
- `docs/mobile-architecture.md` — realtime auth paragraph corrected (handshake header, not `?token=`); route table updated

### Tests & builds actually run

| Check | Result |
|---|---|
| Mobile `npm run typecheck` | **pass** (clean at every batch boundary) |
| Web `npx tsc --noEmit` (apps/web, after the route addition) | **pass** |
| `tsx --test` mobile suites: notifications 16, jobs 11, explore 7, home-scope 3, dm 10 | **47/47 pass** |
| `npm run test:mobile-realtime` (after `dm:` prefix change) | **56/56 pass** |
| `npx expo export --platform android` (production Hermes bundle) | **pass** — 5.54 MB `.hbc`, run at every batch boundary |
| Web unit suite / ESLint | not run in this session (no web lib changes; CI covers) |

**Not verified live:** device/simulator runs (no iOS/Android runtime in this environment) — all mobile verification is typecheck + unit + bundle. The live server flows (join caps, apply eligibility, DM guards) are exercised through the same endpoints the web uses; their server-side rules were read from code but not re-executed here.

---

## E. Outstanding gaps

Ordered by the next concrete action. None of these is hidden behind a fake screen — the
app simply does not show them yet.

1. **Account lifecycle** — *Next action:* decide the mobile signup policy (signup screen needs a self-serve deletion endpoint first for App Store 5.1.1(v)); then port the 3-step signup (+ invitation tokens), forgot/reset, and profile completion. The auth appendix carries the full rule set (password rules differ by flow; `complete_signup` writes in one transaction).
2. **Profiles** — *Next action:* build own + member profile screens (`/api/profile`, `/api/profile/feed`, `/api/profile/identity` cooldowns). This also unblocks **starting a DM** (the web entry is the profile Message chip — mobile currently can only receive, reply and accept) and hosts the identity edit + avatar upload (pass the 400 px avatar cap through `prepareImage`).
3. **Jobs management** — *Next action:* owner actions (edit/close/delete — criteria frozen once an application exists), a JSON route for the applicants board (`get_job_applicants` is RPC-only today), triage statuses, and job posting (needs the verified-company flow — companies search + work-email OTP).
4. **Events** — *Next action:* city browse (`/api/events/city`), detail + RSVP + event-room join; then create/edit (1/month limit, cover upload) for community members. Server contracts are in the jobs/events appendix.
5. **Community management** — *Next action:* join-requests inbox for owners/moderators (the "Members" dot depends on it), mute bell, members list + roles, edit/delete community, tab red-dot watermarks (AsyncStorage port of the web watermark store), invite links.
6. **DM secondary surface** — typing pulse, author edit/delete/reaction actions, blocks/report menus, giphy/attachment sends (send route + upload route exist; UI pending).
7. **Notifications polish** — `Retry-After`-aware copy on 429 at login; per-type deep links beyond community/chat (profile, jobs already route); push payloads for job_match/join_accepted reuse the inbox route map once profiles exist.
8. **Search & library** — the client-side search palette and the curated Library shelf.
9. **Server follow-ups found by the audit (web-side, out of this branch's scope):**
   - `showcase:{postId}` realtime room membership check derives a community id from the room name and fails closed — live showcase comments likely never connect (feed appendix §realtime).
   - `/api/communities/join/[token]` logged-out redirect points at `/auth/login`, which does not exist (real route `/login`).
   - `GET /api/companies/[slug]` JSON route does not exist (company page is RPC-only) — needed when profiles/companies ship on mobile.

### Known approximations in shipped slices (honest list)

- Notification deep links open the community **tab** the notification is about; item-level opens need a by-id fetch for the content kinds (community pages load by list).
- Job "N new" tab badges (web localStorage nicety) are not on mobile yet.
- Saved screen reloads on focus rather than patching live from card actions taken elsewhere in-session (it re-reads, so it converges).
- DM `?peer=` get-or-create is not reachable (no member entry point yet — see gap 2); the endpoint is ready to consume.
