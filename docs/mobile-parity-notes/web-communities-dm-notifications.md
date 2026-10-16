# Web → Mobile parity notes: Communities, DMs & Notifications

Audit of the Next.js web app (`apps/web`) for mobile parity in `expo-app-standalone 3/`.
Read-only audit: every claim below was read from source (paths cited as repo-relative
`path/file:line`). Method per feature: UI page → client lib → API route → authz/business
rules → DB (Supabase migrations / RPCs) → realtime (`apps/realtime`) → UI.

Mobile status at audit time (for prioritising): the Expo app already has a joined-
communities list tab, a community chat screen (send/edit?/reactions/mentions/typing/read),
realtime client with `chat:`-etc. community rooms + `notifications:` user room, push
registration and a notifications settings screen. It has **no** Explore/browse, **no**
join-request flow, **no** DM feature, **no** notifications list page, and its realtime
`USER_ROOM_PREFIXES` do **not** include `dm:` (see §8).

---

## Feature table

| Feature | Web pages | API endpoints (method path) | Auth/roles | Key business rules & edge cases | Realtime | Mobile-relevant constraints | Suggested mobile priority |
|---|---|---|---|---|---|---|---|
| Explore / browse communities | `/dashboard/communities` (`app/dashboard/communities/page.tsx`) | `GET /api/communities/all` | Logged-in user (`verifyActive:false`) | One RPC `get_all_communities`; excludes `type='event'`, `member_count=0`; returns `joined`, `can_join`, `has_pending_request` per row; ordered by name | none (cache store `lib/communities/cache/explore-store`) | One GET returning whole list; no pagination | P1 |
| Explore tabs / search | same page | (client-side only) | — | Tabs All/Public/Private/Requests sent (`lib/communities/explore-filter.ts:19-24`); joined rows and profile-mirror types (sector/city/experience_level/job_title) hidden on all browse tabs; search = name substring, case-insensitive | none | Pure client filtering; replicate exactly | P1 |
| Public join | Explore card, `CommunityJoinDialog` | `POST /api/communities/[id]/join` | Logged-in user; `type='user'` open to all; sector/city/exp/job_title must match profile | 404 unknown/inactive; 403 `PROFILE_MISMATCH` for profile-gated; 429 at 7-membership cap; upsert membership idempotent; `{success:true}` | none (client cache patch) | Body `{}`; errors are user-facing copy | P1 |
| Private join request | Explore card "Request to join", dialog | `POST /api/communities/[id]/join` (same) | same | Optional `message` ≤500 chars; 429 when memberships+pending ≥7; declined rows deleted to allow re-request; upsert pending, idempotent → `{status:"requested",communityId}`; event-type community special path (answers required) | none | Same endpoint as public join — branch on `status` field | P1 |
| Withdraw own request | Requests sent tab / card "Withdraw" | `DELETE /api/communities/[id]/join` | Logged-in user | Deletes only caller's own `pending` row (idempotent, self-scoped) → `{success:true}` | none | — | P1 |
| Requests sent tab | `/dashboard/communities` tab "Requests sent" | `GET /api/communities/all` (filter `has_pending_request`) | Logged-in user | Only own outgoing pending requests; card shows "Withdraw" | none | — | P1 |
| Invite link landing | `/join/[token]` (`app/join/[token]/page.tsx`) | `GET /api/communities/join/[token]` (public, no auth) | none | Token = last 32 hex chars of slug; unknown → server redirect to `/dashboard/communities`; shows name/description/member_count/privacy | none | Mobile should deep-link into the POST, or a native screen; the web page itself is web-only | P2 (deep link) / web-only (page) |
| Invite link accept | `/join/[token]` client | `POST /api/communities/join/[token]` | Logged-in user | `already_member` / `joined` (public) / `requested` (private) / 429 cap on private request; 404 invalid token. Client 401 handler pushes `/auth/login?redirect=…` — **stale path**: app has `/login` only and it does not consume `?redirect` (`app/login/page.tsx:51` reads `data.redirect` from POST) | none | Response `{status}` drives UI | P2 |
| Invite regenerate | Community settings | `POST /api/communities/[id]/invite/regenerate` | Owner or `can_edit_settings` | Rotates `invite_token`; returns full `invite_url` | none | — | P2 |
| Leave community | ⋯ menu → Exit community | `DELETE /api/communities/[id]/members` (no userId = self) | Member | Owner: ownership transfers to earliest-joined member; last member: community hard-deleted (+R2 cleanup) `community_deleted:true`; private: deletes own join-request history | none | Response variants matter | P2 |
| Join requests inbox | Members tab (manager) | `GET /api/communities/[id]/requests` | Owner or `can_manage_members` | Pending only, oldest-first; `{id,user_id,requested_at,name,avatar_url,request_message}` | none (dot via content-latest + requests fetch) | — | P1 (owner/moderator UX) |
| Accept request | Members tab | `POST /api/communities/[id]/requests/[requestId]/accept` | same | 404 unknown; 409 resolved; upsert member role=member; 429 if requester at 7-cap (stays pending); sets `accepted`+`decided_at/by`; notifies + pushes requester | none | — | P1 |
| Decline request | Members tab | `POST /api/communities/[id]/requests/[requestId]/decline` | same | 409 resolved; sets `declined`+`decided_at/by`; no notification to requester | none | — | P1 |
| Members list | Members tab | `GET /api/communities/[id]/members?page&search` | Member (any) | Page size 30, 0-indexed; server-side name search; moderator `permissions` only for owner/admin caller | none | — | P2 |
| Remove member | Members tab | `DELETE /api/communities/[id]/members/[userId]` | Owner or `can_manage_members` | Owner can't be removed; platform `admin` only by platform; `moderator` needs owner/admin; deletes grants then membership; 400 self-removal | none | — | P2 |
| Promote/dismiss moderator | Members tab → permissions modal | `PATCH /api/communities/[id]/members/[userId]` | Owner or platform `admin` only (`canManageModerators`) | `role:"moderator"` grants-first then role; default grants = content moderation on, admin off; `role:"member"` dismisses and deletes grants; owner/admin targets refused | none | — | P2 |
| Edit community | Settings modal | `PATCH /api/communities/[id]` (multipart) | Owner or `can_edit_settings`; **privacy owner-only** | name 1–80, description ≤500, `tabs` json (chat forced, whitelist), `showcase` bool, image jpeg/png/webp ≤10 MB sniffed, `remove_image`, `rules` json ≤12 (wholesale replace); audit `community_settings_updated` | rules → `rules:<cid>` topic `rule` INSERT/DELETE per rule | multipart form-data | P2 |
| Delete community | Settings | `DELETE /api/communities/[id]` | Owner only | Soft delete `is_active=false` (history preserved) | none | — | P2 |
| Archive / "Delete chat" | ⋯ menu | `POST /api/communities/[id]/archive` | Member | Sets `archived_at`,`history_cleared_at`,`last_read_at` on own membership; next message un-archives implicitly (sidebar rule) | none | — | P3 |
| Rules | Info panel | `GET /api/communities/[id]/rules`; bundled in bootstrap | Any logged-in user (not member-gated) | ordered by `order_index` | `rules:<cid>` topic `rule` | — | P2 |
| Mute (bell) | Chat header bell menu | `POST /api/communities/[id]/mute` | Member | `duration` one of `8h` / `1w` / `always` / `off`; timed needs migration else 503; response `{ok,notifications_muted,notifications_muted_until}`; effective mute = forever flag OR deadline>now, deadline never rewritten | none | Response patches caches | P1 |
| Read state / unread badge | Sidebar rows; chat open | `PATCH /api/communities/[id]/read` | Member | Sets `last_read_at=now`, returns `previousLastReadAt`; client read-manager: 30 s cooldown for realtime triggers, bypass on open, skip when 0 unread, debounce bursts, retry w/ backoff | none | — | P1 |
| Tab red dots (watermarks) | Chat header tabs | `GET /api/communities/[id]/content-latest`; `GET .../requests` | Member; activity & requests manager-gated | Per (user,community,tab) watermark in localStorage `uxcommunity:community-tabs:seen:v2:`; anchor to `last_read_at` of page load when never tracked; open tab advances; **members dot = # pending requests > 0, clears when queue empty** | content-insert events update live | localStorage-equivalent (AsyncStorage) + anchor semantics | P2 |
| Community chat send | Chat tab | `POST /api/communities/[id]/messages` | Member | ≤2000 chars or image-only; mentions ≤20 resolved to members; reply anchor message-wins-over-content; rate 5/10 s + 20/60 s; returns 201 `{message}` | publish `chat:<cid>` topic `message` (broadcast to all subscribers; sender's own tabs dedupe by id) + push | Push excludes the sender and muted members | P1 |
(continued below — same table rows continue)

| Feature | Web pages | API endpoints | Auth/roles | Key rules | Realtime | Mobile constraints | Priority |
|---|---|---|---|---|---|---|---|
| Chat edit/delete/reactions | Chat | `PATCH` and `DELETE /api/communities/[id]/messages/[msgId]`; `POST .../messages/[msgId]/reactions` | Author; delete also owner/`can_delete_messages` | Edit ≤15 min (`lib/communities/message-edit.ts:1`), text-only; delete = soft tombstone, wipes content/image/reply, `deleted_by_role` recorded for moderators + audit row; reactions desired-state idempotent, one per user | `message-edit`, `message-delete`, `reaction-insert/update/delete` on `chat:<cid>` | same as web | P2 (verify mobile parity) |
| Chat read/typing/presence | Chat | — (websocket only) | Member | typing client-published topic `typing` (server stamps identity); presence count via socket frames | `typing` topic; presence frames | mobile already implements | P2 |
| Chat retention | DisappearingNotice | `POST /api/internal/community-message-retention` (cron) | Worker secret | 15 days hard delete + R2; announces `messages-expired` | `chat:<cid>` topic `messages-expired` `{cutoff}` | show notice; prune on event | P3 |
| DM conversation list | `/dashboard/messages` list pane | `GET /api/dm/conversations` | Logged-in user | RPC `get_dm_conversations`: only conversations with ≥1 message, `request_state<>'rejected'`, drops peer=blocker rows; limit 200; unread = peer messages > my marker; includes `last_reaction`, `request_state`, `requested_by` | `dm:<uid>` `dm-message` (badge refetch) | must add `dm:` prefix to mobile realtime | P1 |
| DM deep link ?peer= | `/dashboard/messages?peer=<uuid>` | `POST /api/dm/conversations` (server-side on page render) | Logged-in user | get-or-create; invalid/self peer ignored; 429 monthly cap → notice text on empty pane; URL stripped after load | none | Native deep-link equivalent | P1 |
| DM send | DM thread | `POST /api/dm/conversations/[id]/messages` | Participant | Content ≤2000; image only from own conversation prefix or Giphy; `client_nonce` idempotency (23505 → returns original 200 `duplicate:true`); gates: any block → 403; rejected → 403; pending & I'm requester & already ≥1 message → 403 "one message"; nonce already used in other conversation → 409; rate 5/10 s + 20/60 s | `dm:<uid>` both participants, `dm-message`; `dm-request-update` when state moved | — | P1 |
| DM edit/delete/reactions | DM thread | `PATCH` and `DELETE /api/dm/messages/[id]`; `POST /api/dm/messages/[id]/reactions`; `GET /api/dm/messages/[id]` | Participant & author | Same 15-min window; delete wipes content/image/reply; reactions one per user | `dm-message-edit/-delete`, `dm-reaction-*` | — | P2 |
| DM request accept/reject | DM footer | `POST /api/dm/conversations/[id]/request` `{action}` | Recipient only | 409 no request; 403 requester can't answer; idempotent; accepted unlocks both; rejected hides conversation from both lists; rate 30/60 s | `dm-request-update` | — | P1 |
| DM blocks | "…" menu + profile ⋯ | `POST /api/dm/blocks {user_id}`; `DELETE /api/dm/blocks?user_id=` | Logged-in user | idempotent; self-block 422; rate 10/60 s; blocker's list drops conversation; **both directions** can't insert (DB trigger); blocked member keeps history, sends 403 "You can't send messages to this member."; profile of blocked-by-me member renders reduced (no bio/links/tabs) | — | — | P1 |
| DM reports | "…" menu | `POST /api/dm/reports {conversation_id,reason,details}` | Participant | reason from shared list; snapshot of last 20 messages stored; one open report per member per reported user (409); rate 5/60 s | — | — | P2 |
| DM admin queue | `/admin/(protected)/dm-reports` | `GET /api/admin/dm-reports`; `POST /api/admin/dm-reports/[id] {action}` | `admin` session | View `dm_report_queue`; statuses pending/reviewed/dismissed/reopen; no member-facing notification | — | web-only | web-only |
| DM typing | DM thread | `POST /api/dm/conversations/[id]/typing {typing}` | Participant | Rate 8/10 s; server relays over both dm rooms (REST, not socket publish) | `dm-typing` `{conversation_id,user_id,name,typing,ts}` | — | P2 |
| DM unread badge | Topbar Messages | `GET /api/dm/unread` | Logged-in user | Count of conversations with unread peer messages (people-count, not message sum); RPC `get_dm_unread_total` | `dm-message` → debounced refetch | — | P1 |
| Notifications page | `/dashboard/notifications` | `GET /api/notifications` | Logged-in user | Latest 30 only, newest first; `unread_count` = server total unread; 4 tabs w/ per-tab unread counts derived from loaded page | `notifications:<uid>` topics `insert`/`update` | — | P1 |
| Mark read / all | Notifications page | `PATCH /api/notifications {id}` or `{all:true}` | Owner of rows | Scoped by `user_id`; publishes `update` events so other tabs sync | `notifications:<uid>` `update` | — | P1 |
| Bell badge watermark | Sidebar bell | — (client) | — | Badge = unread created **after** last-open watermark (localStorage, monotonic); opening page advances watermark without marking read; before any watermark = server unread count | — | AsyncStorage equivalent | P1 |
| Notification preferences | `/dashboard/settings/notifications` | `GET/PATCH /api/push/settings` | Logged-in user | GET: preferences+defaults, `mutedCommunityIds`, `unreadCount`; PATCH partial: chatPushEnabled, communityPushEnabled, chatSound, quietHours*, email*; `mutedCommunityIds` array = **exact** mute set (unmutes all then mutes list) | — | identical API for mobile settings screen | P1 |
| Push register | — (mobile only) | `POST/DELETE /api/push/register` | Logged-in user | Token `Expo(nent)?PushToken[...]`, platform ios/android; upsert on token PK (re-points on account switch); DELETE scoped to caller | — | already used by mobile | P1 (exists) |
| Push: community message | — | sent inside message POST `after()` | — | Recipients = members minus sender, minus muted (forever + unexpired timed), minus `chat_push_enabled=false`; quiet hours/budget/sound → silent; badge = total unread across communities; payload `type:"community_message"`; collapseId `community-<cid>` | — | payload contract | P1 |
| Push: join accepted | — | inside accept route `after()` | — | Gated by `community_push_enabled` (not chat switch); quiet hours/sound; collapseId `membership-<cid>` | — | — | P2 |

---

## 1. Community discovery & browse

**Page:** `apps/web/app/dashboard/communities/page.tsx` (client component).
- Fetch: `GET /api/communities/all` once, stored in a shared external store (`exploreStore`,
  `lib/communities/cache/explore-store.ts`; consumed via `useExploreCommunities`,
  `page.tsx:178-217`). Stale window `EXPLORE_STALE_MS` with in-flight dedupe.
- Response: `{ communities: Array<{ id, name, type, image_url, lottie_url, lottie_format,
  description, is_private, member_count, joined, can_join, has_pending_request }> }` —
  columns come from DB function `public.get_all_communities(p_user_id)`
  (`supabase/migrations/20261012140000_explore_pending_join_request.sql`).
- Server rules in the RPC: `is_active=true`, `member_count > 0`, **event group chats
  excluded**, ordered by name. `can_join` mirrors join eligibility: `type='user'` always
  true; sector/city/experience_level/job_title compare the caller's `designer_profiles`
  fields to `communities.reference_id`. `joined`/`has_pending_request` are EXISTS probes
  against `community_members` / `community_join_requests status='pending'`.
- `image_url` is resolved per type from master data (city/sector/experience/job) with the
  stored column as fallback; `lottie_url`/`lottie_format` likewise.

**Tabs & search (client-only):** `lib/communities/explore-filter.ts`.
- Tabs, in order: `All`, `Public`, `Private`, `Requests sent` (`:19-24`). Public/Private are
  the absence/presence of `is_private` (`:37-39`); "Requests sent" is a different list:
  rows with `has_pending_request` (`:59`).
- Rows hidden on the discovery tabs: `joined=true` (`:60`), and the four profile-mirror
  types sector/city/experience_level/job_title (`:33`, `:61`) — these are profile-derived
  communities, joined only by profile match, never browsable.
- Search = `name.toLowerCase().includes(term)` (`:56`).
- List split: `recommended` = `can_join` true → "Recommended for you"; `rest` = `!can_join`
  → "All communities" / "More communities" (`page.tsx:259-260`, `:356-393`).

**Card states** (`CommunityCard`, `page.tsx:34-167`):
- `joined` → accent "Joined" pill; whole card clickable → `/dashboard/communities/${id}`.
- locked (`!can_join && !joined`) → disabled ghost "Join" + lock icon, hover tooltip
  `"Update your profile to join"` (`LOCK_REASON` is an empty map, `:30`, `:125`).
- `has_pending_request` → on Requests tab: "Withdraw" button (DELETE join, `:229-247`);
  elsewhere: disabled "Request sent".
- private not-joined → "Request to join" → opens `JoinCommunityModal`; public → "Join".
- member_count rendered with `toLocaleString()` + pluralization (`:92`).
- Empty states: "No communities found"; Requests tab: "No pending requests" + hint.

**Errors:** 401 Unauthorized if not logged in; 500 `{error:"Failed to fetch communities."}`
plus a `database` object when the RPC fails (`app/api/communities/all/route.ts:43-50`).

**Community preview (non-member):** opening a community you don't belong to renders
`CommunityPreview` (`app/dashboard/communities/[id]/page.tsx:70-87`) fed by
`GET /api/communities/[id]/preview` (member-agnostic; 404 when missing/inactive) →
`{preview:{id,name,type,is_private,image_url,description,member_count,can_join,
has_pending_request,joined}}` (`lib/communities/preview.ts:10-97`). The same dialog
(`CommunityJoinDialog`) is reused across Explore, home feed popups and the Suggested rail
(`components/communities/JoinCommunityModal.tsx:23-41`).

**Badges:** `CommunityNameBadges`/`communityNameBadges` (`lib/communities/community-badges.ts`)
render the verified seal for default (profile-mirror) communities and the lock for private
ones; a row written before `is_private` existed reads as public (`explore-filter.ts:37-39`).

---

## 2. Join / leave / join requests / invite links

### 2.1 POST `/api/communities/[id]/join` (`app/api/communities/[id]/join/route.ts`)
- Auth: `requireSession("user")` (401/403; liveness check on writes) `:38`.
- Body (optional): `{ message?: string (trim ≤500), answers?: Record<string,unknown> }` `:44-48`.
- Order of checks:
  1. Community must exist, `is_active=true` else 404 (`:53-62`).
  2. **Event-type community** (`type='event'`) — group chat join: `answers` compulsory,
     missing → 400 "Please answer all the host's questions to join."; `canJoinEventChat`
     (event public OR caller in the event's own community) else 403; membership upsert;
     answers stored best-effort (`:70-121`).
  3. **Profile-gated types** (`sector`,`city`,`experience_level`,`job_title`): profile must
     match `reference_id` else 403 `{code:"PROFILE_MISMATCH", error:"You can only join …"}
     ("Update your profile to match, then request to join." / "…you'll join automatically."
     for public)` (`:124-174`). `type='user'` is free for all (`:124`).
  4. **Private** → join-request flow (`:177-218`):
     - 429 when `memberships + pending >= 7` (`JOIN_LIMIT`, `lib/communities/join-slots.ts:14,66-68`);
       message includes actual counts (`joinCapMessage`, `:84-87`).
     - Deletes caller's own `declined` row first, then upserts `{status:'pending'}`
       with `ignoreDuplicates` (idempotent; a re-request after decline resets to pending).
     - `request_message` written only when the optional migration column exists.
     - Returns `200 {status:"requested", communityId}`.
  5. **Public** → membership upsert `ignoreDuplicates`; DB `creation_limits` trigger can
     raise `limit:community_joins` → 429 with cap copy (`:220-247`); success `{success:true}`.
- Both paths call `revalidateTag(SUGGESTED_COMMUNITIES_TAG)` so the home rail drops the row.

### 2.2 DELETE `/api/communities/[id]/join` — withdraw
Deletes only `(community_id, user_id, status='pending')` — self-scoped, idempotent, leaves
accepted/declined history untouched (`:250-276`). Returns `{success:true}`.

### 2.3 Join-request state machine (requester view)
| State | DB | Explore card (Requests tab) | Dialog | Notes |
|---|---|---|---|---|
| none | no row | "Join" / "Request to join" | open | — |
| pending | `status='pending'` | "Withdraw" | "Request sent — We'll notify you once an owner accepts it." | re-request idempotent |
| declined | `status='declined'` | rows deleted → card back to "Request to join" next POST | — | decline sends **no** notification; a fresh POST deletes the declined row then re-pends |
| accepted | `status='accepted'` + membership | row disappears from Explore (now joined → sidebar) | — | notification `join_request_accepted` + push (§7) |

There is no "rejected" UI state beyond the card reverting; the requester is never told
about a decline (no notification is created in the decline route).

### 2.4 Manager review it APIs
- `GET /api/communities/[id]/requests` — owner or `can_manage_members` (else 403), 404 if
  community gone. Pending only, `requested_at` ascending. Rows enriched with `name`,
  `avatar_url`, optional `request_message` (`app/api/communities/[id]/requests/route.ts:24-70`).
- `POST .../requests/[requestId]/accept` — 404 unknown; 409 `"Request already resolved."`;
  membership upsert role `member`; if requester is at the 7-slot cap the DB trigger raises
  and the route answers **429** with third-person copy and leaves the request pending
  (`route.ts:41-59`); sets `status='accepted'`, `decided_at/by`; audit
  `join_request_accepted`; `deferNotification(join_request_accepted)` + deferred push
  (`:62-107`).
- `POST .../requests/[requestId]/decline` — sets `declined` + decision columns + audit;
  nothing else (`decline/route.ts:36-52`).

### 2.5 Invite links (`app/join/[token]`)
- Token format: `randomUUID().replace(/-/g,'')` (32 hex) stored in `communities.invite_token`;
  the shareable URL is `/join/<slug>-<token>`; `extractToken` takes the **last 32 hex chars**
  of the segment (`app/api/communities/join/[token]/route.ts:9-13`).
- `GET /api/communities/join/[token]` — **no auth** (public preview) `:20-45`; 400 invalid
  token shape, 404 unknown/expired. Returns `{community:{id,name,type,image_url,is_private,
  description,member_count}}`.
- `POST` — auth required (401 if logged out). `already_member` → `{status:"already_member"}`;
  private → cap-checked request upsert → `{status:"requested"}`; public → insert with
  `role:"member"` → `{status:"joined"}`; 429 on any creation limit; 500s otherwise
  (`:52-135`).
- **Login-required redirect bug to note:** client catches 401 and does
  `router.push('/auth/login?redirect=/join/<token>')` (`JoinCommunityClient.tsx:39-43`) —
  but the app's login route is `/login` and it ignores a `?redirect` query (it navigates to
  `data.redirect ?? "/dashboard"` from the POST body, `app/login/page.tsx:51`). So the
  logged-out invite flow's redirect goes to a 404. Mobile should deep-link to its own login
  and then re-POST the token.
- Regeneration: `POST /api/communities/[id]/invite/regenerate` (owner or
  `can_edit_settings`) returns `{invite_token, invite_url}` with full host built from
  request headers (`invite/regenerate/route.ts:39-66`).
- Invite landing UI states: idle/loading/error, "Joined! Redirecting…" (auto-redirect
  1.2 s to the community), "Request sent — The community owner will review your request."
  Private CTA "Request to join", public CTA "Join community" (`JoinCommunityClient.tsx`).

### 2.6 Leave
`DELETE /api/communities/[id]/members` (self): owner → earliest-joined member becomes owner
(role updated too); last member → hard delete + `community_join_requests` cleanup + R2 media
cleanup, response `{success:true, community_deleted:true}`; normal → `{success:true}` (owner
case adds `ownership_transferred:true`); private communities also delete the leaver's join
request rows so a rejoin needs re-approval (`members/route.ts:149-260`).

---

## 3. Membership roles & moderation

### 3.1 Role model (`lib/communities/manager-role.ts`)
- Roles: `owner`, `admin` (platform-appointed, only in app-created communities), `moderator`
  (appointed in-app), `member` (`:27`). Resolution: community `owner_id` match OR membership
  `role='owner'` ⇒ owner (`:52-61`).
- Effective permissions: owner ⇒ all; member ⇒ none; admin/moderator read
  `community_admin_permissions`. **Missing row: admin ⇒ all (historically permissive),
  moderator ⇒ none** (`:70-98`).
- `canManageModerators = owner || admin` (`:143`). `managerActorRole` maps to audit strings
  (`:165-170`).
- Permission keys (`lib/communities/permissions.ts:7-15`): `can_edit_settings`,
  `can_manage_members`, `can_delete_messages`, `can_moderate_threads`,
  `can_moderate_showcase`, `can_moderate_resources`, `can_moderate_events`.
  `MODERATOR_DEFAULT_PERMISSIONS` = the 5 content-shaped ones true, the 2 admin ones false
  (`:46-54`).

### 3.2 Members UI/API
- `GET /api/communities/[id]/members?page&search` — any member; page size 30, 0-indexed,
  server search, RPC `get_community_members_page`; returns `{members:[{user_id,joined_at,
  role,name,avatar_url,designation, permissions?}], has_more, total}`; `permissions` only
  for moderator rows and only to a `canManageModerators` caller (`members/route.ts:23-131`).
- `GET /api/communities/[id]/members/[userId]` — lightweight name+avatar+designation for a
  chat sender not in local cache; caller must be a member (`:25-75`).
- `DELETE .../members/[userId]` rules (`:85-163`): caller needs owner or
  `can_manage_members`; cannot remove self (400, different copy for owner); target owner ⇒
  400; target admin ⇒ 400 "Platform admins are managed by the platform."; target moderator
  requires `canManageModerators` else 403; deletes `community_admin_permissions` then the
  membership; audit `member_removed`.
- `PATCH .../members/[userId]` (`:178-319`): only `canManageModerators`; body
  `{role:"moderator"|"member", permissions?: partial toggles}`. Promote writes grants first
  (upsert on `community_id,user_id`, `granted_by`) then flips role; dismiss flips role to
  member and deletes grants. Owner/admin targets refused. Responses echo
  `{member:{user_id,role,permissions}}`.
- There is **no "ban"** (removal is a plain membership delete; a removed member can
  re-join/re-request), no kick-with-duration, no per-member history beyond the activity
  feed.
- Member list pagination in UI: `MembersView.tsx` fetches `/members?page=` (PAGE_SIZE 30)
  plus `/requests` and `/event-join-responses`; accept/decline/remove/promote all go
  through the routes above (`components/communities/members/MembersView.tsx:197-374`).

### 3.3 Edit / delete
- `PATCH /api/communities/[id]` (`app/api/communities/[id]/route.ts:41-261`): caller owner
  or `can_edit_settings` (else 403); multipart form-data fields `name` (1–80 → 422),
  `description` (≤500 → 422), `is_private` (**owner-only** — silently ignored for
  managers, `:113-118`), `tabs` (JSON array, whitelist `chat|threads|events|resources`,
  `chat` always forced in, `:120-132`), `showcase` (`"true"|"false"`, column-gated,
  `:134-142`), `image` (jpeg/png/webp, ≤10 MB, MIME sniffed; R2 key
  `communities/<uid>/<ts>-<rand>.<ext>`), `remove_image=true`, `rules` (JSON string array,
  trimmed, ≤12 — wholesale delete+reinsert, publishes `rules:<cid>` topic `rule`
  INSERT/DELETE events `:195-246`). Audit: single `community_settings_updated` with
  `changed[]` of `name|description|privacy|tabs|showcase|photo|rules` (`:250-258`).
  Response `{success:true, image_url?}`.
- No accent-color field exists anywhere for communities (accent is a theme token, not stored
  per community). There is no "type" change, no owner transfer endpoint.
- `DELETE /api/communities/[id]` — owner only, soft delete `is_active=false`
  (`:265-293`).
- Settings UI: `CommunitySettingsView.tsx` calls PATCH `:215-216`, DELETE `:248`,
  invite regenerate `:182`; showcases privacy control is hidden/disabled for non-owner
  managers ("community admin" banner copy, `:399-402`).

### 3.4 Rules
`GET /api/communities/[id]/rules` — **any logged-in user** (not member-gated), ordered by
`order_index` (`rules/route.ts:12-23`). Also bundled into the bootstrap payload under
`rules` with the same shape (`bootstrap/route.ts:84-92`). Realtime: `rules:<cid>` topic
`rule` with `{event:"INSERT"|"DELETE", rule}` on edit/create.

### 3.5 Mute
- `POST /api/communities/[id]/mute` body `{duration}` where duration ∈
  `8h | 1w | always | off` (422 otherwise) (`mute/route.ts:44-57`).
- Member-only (403) `:59-68`; timed mutes 503 if the column migration is not applied
  `:72-78`.
- Writes: timed ⇒ `{notifications_muted:false, notifications_muted_until:now+duration}`;
  `always` ⇒ `{notifications_muted:true, …until:null}`; `off` ⇒ both cleared.
  Response `{ok, notifications_muted, notifications_muted_until}` (`:80-109`).
- Effective semantics (`lib/communities/mute.ts:6-13,27-37`): muted while forever flag OR
  deadline in the future; the deadline is never rewritten when it passes. Unread counts are
  untouched by mute (an unread message stays unread).
- UI: bell button **beside** the ⋯ menu in the chat header
  (`components/communities/chat/ChatHeader.tsx:385-449`); menu labels "8 hours", "1 week",
  "Always" (`:83-87`); when muted the single action is "Unmute notifications" with sublabel
  `Muted` or `Muted until <date> at <time>` (`:187-197`); toast "Chat muted" with Undo,
  "Chat unmuted" (`:257-299`). The ⋯ menu holds "Delete chat" (archive) and "Exit
  community" (`:461-484`).

### 3.6 Read state, unread counts and tab dots
- `PATCH /api/communities/[id]/read` sets `last_read_at=now` and returns the previous value
  so the client can position the unread divider (`read/route.ts:32-52`). Client manager
  `lib/communities/read-manager.ts`: 30 s cooldown for realtime-triggered marks, bypass on
  user open, skip when sidebar already 0, debounce bursts, in-flight dedupe + one follow-up,
  one retry with backoff; updates both the sidebar store and the cached sidebar request
  (`mark-read.ts:18-46`).
- Sidebar projection `GET /api/communities` (RPC `get_sidebar_activity` + communities rows)
  returns per-community `message_count` (unread), `mention_count`, `unread_content_count`,
  `last_message`, `lastReaction`, `notifications_muted(_until)`, `is_archived`
  (`lib/communities/sidebar-server.ts:79-245`). Archive rule: archived while
  `archived_at` is set and the newest message is not newer than it (`:208`).
- Tab dots (`components/communities/chat/useCommunityTabDots.ts`, `lib/communities/tab-seen.ts`):
  - Threads/Showcase/Resources/Events/Activity each carry a red dot while the newest item
    of that kind is newer than the per-`(user,community,tab)` watermark persisted in
    localStorage under `uxcommunity:community-tabs:seen:v2:<uid>:<cid>` (`tab-seen.ts:27`).
  - A never-tracked tab is anchored to the member's `last_read_at` at page load so content
    created since the last visit dots and older content does not (`useCommunityTabDots.ts:174-198`).
  - Opening the community does **not** advance tab watermarks; opening the tab does
    (`tab-seen.ts` docs, `useCommunityTabDots.ts:186-189`).
  - Baseline for comparison comes from `GET /api/communities/[id]/content-latest`
    (`{latest:{thread,showcase,resource,event,activity}}`, activity only for
    `canManageModerators`) (`content-latest/route.ts:43-69`).
  - **Members dot = outstanding work:** shown while `GET .../requests` reports any pending
    request; the owner/admin fetches it on mount (`useCommunityTabDots.ts:129-139,214-216`)
    and `MembersView` reports its live count so resolving the last request clears it
    immediately (`:226-229`).

---

## 4. Community chat

### 4.1 Send — `POST /api/communities/[id]/messages` (`app/api/communities/[id]/messages/route.ts`)
- Rate limits first: `chat:send:<uid>:10s` 5/10 s and `chat:send:<uid>:60s` 20/60 s;
  burst 429 "Too many messages. Please slow down." with `Retry-After`; minute 429 "…try
  again shortly." (`:104-149`).
- Membership required (403 "Not a member of this community.") `:153-159`.
- Body contract (`lib/communities/message-request.ts`): `content` trimmed, **max 2000**
  chars (`:38`); `image_url`; `reply_to_id`; `reply_to_content {id,kind∈thread|showcase|
  resource|event}`; `mentions` = opaque member ids (deduped, self dropped, max
  `MENTION_MAX_PER_MESSAGE`=20, dropped when no text) (`:32,93-108`). Invalid JSON → 400;
  empty with no image → 422; too long → 422.
- Message anchor wins over content anchor; a `reply_to_id` not in this community is silently
  dropped; a content anchor that doesn't resolve is dropped with its preview fields
  (`route.ts:179-204`).
- Mentions are validated against `community_members` and names resolved server-side into
  `[{user_id,name}]` stored on the row (`:206-235`).
- Insert returns the row; response 201 `{message:{…, users:null, reactions:[], reply_to:null,
  reply_to_content_id, reply_content_kind, reply_content_title, image_url, mentions}}`
  (`:295-310`).
- `after()` publishes the chat room event and fires push (`announceNewChatMessage`,
  `lib/communities/message-publish.ts:61-118`).
- Attachments: `POST /api/communities/[id]/messages/upload` — member-gated; jpeg/png/webp,
  raw ≤20 MB, MIME sniffed, R2 key `community-messages/<cid>/…` (`messages/upload/route.ts`).

### 4.2 Edit / delete / reactions
- `PATCH .../messages/[msgId]`: author only; empty → 422; >2000 → 422; deleted message →
  409; no text → 409; **15-minute window** (`canEditMessage`, `lib/communities/message-edit.ts:1-9`)
  → 409 "Messages can only be edited within 15 minutes of sending."; realtime
  `message-edit` `{id,content,edited_at}` (`messages/[msgId]/route.ts:14-81`).
- `DELETE .../messages/[msgId]`: own message OR manager with `can_delete_messages` (owner
  included); anyone else 403. Soft delete: `deleted_at`, `deleted_by`, `deleted_by_role`
  (owner/admin/moderator for moderation, null for self), content/image/reply wiped; R2
  image cleanup; moderation deletes also write an Activity row with a ≤140-char excerpt
  (`:91-192`). Realtime `message-delete` `{id,deleted_at,deleted_by,deleted_by_role}`.
- `GET .../messages/[msgId]`: reply-preview lookup for parents not in cache; member-gated
  (`:203-252`).
- `POST .../messages/[msgId]/reactions` body `{desiredEmoji: string|null}` — desired-state
  (idempotent, no inversion on retries), one reaction per user per message via unique
  `(message_id,user_id)`; publish only on a real transition (`reaction-insert/update/
  delete`); response `{reactions:[{emoji,user_ids}], currentUserEmoji}`
  (`messages/[msgId]/reactions/route.ts:11-157`).

### 4.3 Read — `GET /api/communities/[id]/messages`
- Membership required (403); page size 50 (`read-models.ts:25`).
- History window starts at `max(joined_at, history_cleared_at)` for the caller
  (`read-models.ts:423-425`) — the archive/"Delete chat" reset.
- Compound cursors `(created_at,id)`: `before`+`before_id` (older) or `after`+`after_id`
  (catch-up drain); malformed halves → 400 "Invalid cursor." (`read-models.ts:426-440`;
  migration `20261013100000_community_message_compound_cursor.sql`; a staged-deploy fallback
  pages on timestamp only, `message-cursor-support.ts`).
- `?withContentReactions=1` adds `content_reactions` (grouped emoji for "created a …" cards)
  plus per-message `reply_to_content_*` fields (`messages/route.ts:53-75`).
- Rows come back oldest-first after reversal; each message carries `users`, `reactions`,
  `reply_to`, `mentions`, `edited_at`, `deleted_at`.
- Client: `useChatData.ts` fetches newest page (3-min stale cache), drains `?after=` pages
  on reconnect up to `MAX_CATCH_UP_PAGES`, paginates older with `?before=`; unread divider
  positioned by `lastReadAtOnOpen` (`useScrollAndUnread`).

### 4.4 Retention (15 days)
- `CHAT_MESSAGE_RETENTION_DAYS = 15` (`lib/communities/message-retention.ts:13`).
- Sweep: Cloudflare cron every 6 h POSTs `/api/internal/community-message-retention`
  (`apps/realtime/src/index.ts:86,99-105`; `apps/realtime/src/retention.ts`); the web route
  runs `sweepExpiredChatMessages` (`lib/communities/message-retention-sweep.ts:128-217`):
  hard-deletes rows older than the cutoff in batches of 500 (24 s budget), deletes R2
  images, then publishes one `messages-expired` per affected community (≤100 communities),
  carrying `{cutoff}`; clients prune cached messages and drop them on next fetch otherwise.
  Reactions cascade; replies keep their row with `reply_to_id` set null.

### 4.5 Typing & presence (client-only protocols)
- Typing: client publishes topic `typing` over its own chat-room socket (the **only**
  client-publishable topic; `apps/realtime/src/client-publish.ts:51`), payload
  `{typing:boolean,user_id?,name?,ts?}` — identity is stamped from the socket, never trusted
  (`:144-175`); per-socket burst 12 @4/s, per-user burst 24 @8/s (`:72-84`). Client throttle
  1 frame/s, idle 1.6 s, expiry 3.5 s (`components/communities/chat/useTypingPresence.ts:8-10`).
- Presence: the DO broadcasts `{t:"presence", count}` frames coalesced
  (`apps/realtime/src/presence.ts`); client renders "N online" (`useOnlinePresence`).
- Browser notifications are a web-only nicety: `lib/communities/message-notifications.ts`
  uses the Notification API + optional sound, gated by localStorage prefs; push replaces it
  on mobile (§7).

### 4.6 API vs client-only summary (chat)
| Capability | Server (API/DB) | Client-only |
|---|---|---|
| send/edit/delete/reactions/replies/mentions | yes (§4.1–4.2) | optimistic rendering, dedupe |
| typing | no (socket publish path only) | yes |
| presence count | DO broadcast (no persistence) | rendering |
| unread counts / read markers | yes (`last_read_at`, RPC `get_sidebar_activity`) | debounce/cooldown/read floor |
| tab dots | `content-latest` + `requests` baseline | localStorage watermarks, members-dot composition |
| retention | yes (15-day sweep) | pruning on `messages-expired` |

---

## 5. Direct messages

### 5.1 Conversation list
- Page `/dashboard/messages` (`app/dashboard/messages/page.tsx`): server component; redirects
  to `/login` when not `role=user`; loads own name/avatar; `?peer=<uuid>` GET-or-creates the
  conversation before the first paint so the window opens even with zero messages; invalid or
  self peer ignored; monthly-cap 429 becomes `limitNotice` copy on the empty pane (`:16-66`).
- `GET /api/dm/conversations` → `{conversations:[{id, peer:{id,name,avatar_url},
  last_message:{id,content,image_url,created_at,user_id,deleted_at,edited_at}|null,
  unread_count, my_last_read_at, last_message_at, last_reaction|null, request_state,
  requested_by, blocked_by_me}]}`; server RPC `get_dm_conversations` (migration
  `20261015100000_dm_requests_blocks_reports.sql:299-440`) rules: participant, at least one
  message (`last_message_at not null`), `request_state <> 'rejected'`, **drops rows the
  viewer blocked**, newest first, limit 200; `blocked_by_me` is always false from the list
  (server already dropped them; only locally patched state / `?peer=` carry it)
  (`lib/direct-messages/server.ts:217-246`).
- `POST /api/dm/conversations {peer_user_id}` — create-or-get; UUID validated (422 "Invalid
  member."), self → 422 "You cannot message yourself.", unknown peer → 404; rate
  `dm:create:<uid>:60s` 30/60 s; RPC `get_or_create_dm_conversation` enforces
  `dms_monthly` = **5 new conversations per UTC month** (429 with copy "You can start
  conversations with up to 5 new people a month.") (`conversations/route.ts:37-93`;
  `lib/creation-limits.ts:17-18`). Response 201 `{conversation}`.
- Client list pane: search by peer name (client-side, `lib/direct-messages/search.ts`);
  rows hide `blocked_by_me` and `rejected` locally too (`DmListPane.tsx:55-57`); unread blue
  pill ≥1 (99+ cap, `:220-227`); incoming pending request row shows "Message request"
  instead of the preview (`:178-183`); typing label takes priority over all previews
  (`:173-177`); reaction preview "John reacted ❤️ to: …" (`:184-201`).

### 5.2 Request lifecycle (the cap)
- Conversations start `request_state='pending'`, `requested_by=null`. The **first message
  from either side** becomes the request: the insert trigger `dm_message_guard`
  (`supabase/migrations/20261015100000_dm_requests_blocks_reports.sql:141-217`) sets
  `requested_by = new.user_id`; while pending, the requester may hold **exactly one
  message** (DB `raise 'One message until the request is accepted'`); **a reply from the
  other participant is an implicit acceptance** (sets `accepted`); a rejected conversation
  refuses all inserts; a blocked pair refuses inserts from either direction. The guard locks
  the conversation row `for update` first so concurrent sends serialize.
- Pre-send gates in the route mirror this for user-friendly copy
  (`app/api/dm/conversations/[id]/messages/route.ts:178-208`): blocked either way → 403
  "You can't send messages to this member."; rejected → 403 "This message request was
  declined."; pending+requester+count≥1 → 403 "You can send one message until your request
  is accepted."
- Client pre-send hint (project memory's "pre-send hint"): while `request_state==='pending'`
  and `requested_by===null` the composer shows "*You can send one message until <peer>
  accepts your request — then you can chat regularly.*" (`DmThread.tsx:163-166,392-402`).
- Recipient's answer: `POST /api/dm/conversations/[id]/request {action:"accept"|"reject"}`
  (`[.../request]/route.ts`): 400 bad body; 429 rate (30/60 s); 404/403 from access check;
  409 "No request is waiting for an answer." when `requested_by` null; 403 "Only the
  recipient can answer this request."; idempotent (same state → 200); conditional UPDATE on
  `pending` so racing devices settle on the first answer; publish `dm-request-update`.
  **Reject closes the conversation for both sides** (leaves both lists; composer replaced by
  a declined notice; the requester reads "Your message request was declined — you can't send
  more messages here.").
- Footer state machine (`DmThread.tsx:152-167,313-424`): `blockedByMe` → blocked bar w/
  Unblock; incoming request → Accept/Reject buttons; outgoing request → "Message request
  sent — <peer> needs to accept before you can send more."; rejected → notice; otherwise the
  normal composer.

### 5.3 Sending / message features
- `POST /api/dm/conversations/[id]/messages` (`app/api/dm/conversations/[id]/messages/route.ts`):
  - Rate 5/10 s + 20/60 s per user (`:140-171`).
  - Participant check (403 "You are not part of this conversation.") `:173-176`.
  - Body: `content` ≤2000; `image_url` must be `https` AND (own conv prefix in R2 or
    `*.giphy.com`) else 422 "Invalid image URL." (`lib/direct-messages/assets.ts:24-40`);
    `reply_to_id` UUID, invalid/missing parent silently dropped; `client_nonce` UUID.
  - Idempotency: unique `(user_id, client_nonce)`; a retry returns 200 `{duplicate:true,
    message:<original>, request_state, requested_by}`; nonce reused in a different
    conversation → 409 (`:277-334`).
  - Response 201 `{message:{…,users:null,reactions:[],reply_to:null,image_url}, request_state,
    requested_by}` — the post-send request state lets the composer swap without a refetch.
  - Realtime `dm-message` to **both** `dm:<user_a>` and `dm:<user_b>` rooms; if the guard
    moved the state (first message / implicit accept) an extra `dm-request-update` is
    published (`:347-401`; `lib/direct-messages/publish.ts:22-36`).
- Edit/delete/reactions:
  - `PATCH /api/dm/messages/[id]` — author only, text only, same 15-min window; realtime
    `dm-message-edit` (`dm/messages/[id]/route.ts:52-116`).
  - `DELETE` — author only (**no moderation in a 1:1 conversation**) — wipes
    content/image/reply, soft `deleted_at`; realtime `dm-message-delete`; R2 cleanup
    (`:125-183`).
  - `GET /api/dm/messages/[id]` — reply-preview lookup for cache misses (`:191-222`).
  - Reactions: desired-state idempotent, one per user; topics `dm-reaction-insert/update/
    delete` (`dm/messages/[id]/reactions/route.ts:16-160`).
- Attachments: `POST /api/dm/conversations/[id]/upload` (participant; jpeg/png/webp input
  ≤20 MB, MIME sniffed, key `dm/<conversationId>/…`); `DELETE …/upload {url}` releases an
  abandoned upload only under this conversation's prefix; a URL still referenced by a
  `dm_messages` row is kept (`dm/.../upload/route.ts:25-163`). The client compresses to
  WebP before upload; GIPHY URLs ride the send's `image_url` (`/api/giphy`).
- Typing: `POST /api/dm/conversations/[id]/typing {typing}` — rate 8/10 s; server publishes
  to both rooms `dm-typing` `{conversation_id,user_id,name,typing,ts}` (the DM typing pulse
  cannot be a client socket publish because it must cross to the other member's DO; comment
  `dm/.../typing/route.ts:8-16`). Client at most 1 pulse/s + a stop pulse.

### 5.4 Read markers & unread badge
- `PATCH /api/dm/conversations/[id]/read {last_read_at}` — the timestamp of the newest
  **displayed** message (400 if missing/invalid); RPC `mark_dm_conversation_read` stores
  `greatest(existing, incoming)` and refuses non-participants (404 P0002 / 403 42501);
  response `{ok, previousLastReadAt, markedAt}` (`dm/.../read/route.ts:20-78`).
- Client manager (`lib/direct-messages/read-manager.ts`): debounce 500 ms, 20 s cooldown,
  coalesce to newest, read-floor cache so a stale list payload can't resurrect the badge;
  `isActivelyReading` lets realtime paths skip bumping while the thread is open.
- **No read receipts** to the peer (the marker is per-viewer and never exposed to the other
  participant) — "read by peer" is not part of the design.
- Badge: `GET /api/dm/unread` → `{count}` = number of **conversations with unread peer
  messages** (people-count, not message sum) via RPC `get_dm_unread_total`
  (`lib/direct-messages/server.ts:317-328`; `useDmUnreadBadge.ts` refetches (debounced
  600 ms) on `dm-message` events unless actively reading).

### 5.5 Blocks (semantics, both directions)
- `POST /api/dm/blocks {user_id}` / `DELETE /api/dm/blocks?user_id=` — idempotent upsert /
  delete on `(blocker, blocked)`; self 422; rate 10/60 s; 404 unknown target
  (`dm/blocks/route.ts:31-105`).
- Effects:
  - Blocker's conversation list drops the row (RPC filter) — the blocked member's list
    **keeps** its history (their own `request_state<>rejected`, no block filter in their
    direction; `get_dm_conversations` only filters `blocker_id = p_user_id`).
  - **New messages are refused in BOTH directions** (trigger scans both orders:
    `(b.blocker_id=a and b.blocked_id=b) or (b.blocker_id=b and b.blocked_id=a)`).
  - The blocked member's sends fail with 403 "You can't send messages to this member."
    (they see no block banner; composer stays until the send fails).
  - Blocker's thread shows a blocked bar: "You blocked <name>. They can't send you
    messages." + Unblock (`DmThread.tsx:321-339`); ⋯ menu offers "Unblock user" instead of
    "Block user" (`:225-251`).
  - Profile surfaces: while the viewer has a member blocked, the profile renders a **reduced
    view** — identity + "You blocked <name>. They can't message you or see your profile."
    + Unblock; bio, links, workplace and the activity tabs are suppressed
    (`app/dashboard/profile/components/ProfileCard.tsx:109-145,411-441`).
- Reactions/edits of old rows are unaffected (guard is INSERT-only).

### 5.6 Reports
- `POST /api/dm/reports {conversation_id, reason, details?}` — reason must be one of the
  shared `REPORT_REASONS` (`lib/communities/report-reasons.ts:12-20`: spam, harassment,
  hate, misinformation, inappropriate, intellectual_property, off_topic, other); details
  ≤1000; participant-only; rate 5/60 s; stores `reported_user_id` (the peer) + a snapshot of
  the last 20 messages (author names resolved, oldest-first); 409 when an earlier report is
  still pending (`dm_reports_pending_unique`); 201 `{ok:true}`
  (`dm/reports/route.ts:26-95`).
- Admin queue (web-only): `GET /api/admin/dm-reports?status=&reason=&search=&page=` reads the
  `dm_report_queue` view, page size 25, tab counts pending/reviewed/dismissed
  (`admin/dm-reports/route.ts:17-78`); `POST /api/admin/dm-reports/[id] {action:
  "reviewed"|"dismissed"|"reopen"}` updates `status/resolved_at/resolved_by` — **no
  member-facing notification** is created (`admin/dm-reports/[id]/route.ts:18-66`).

### 5.7 DM model / tables
`dm_conversations` (participants canonically `user_a<user_b`, `request_state
pending|accepted|rejected`, `requested_by`, per-side read markers, `last_message_at`,
`client_nonce`-unique `dm_messages`), `dm_message_reactions`, `dm_blocks`, `dm_reports`
(migrations `20261012100000_direct_messages.sql`, `20261012120000_dm_hardening.sql`,
`20261015100000_dm_requests_blocks_reports.sql`). Message page RPC `get_dm_message_page`
returns `{id,content,created_at,user_id,reply_to_id,image_url,deleted_at,edited_at,users:
{name,avatar_url},reactions:[{emoji,user_ids}],reply_to:{id,content,user_name,user_id}}`,
newest-first capped at 50/server (client reverses; page size constant
`lib/direct-messages/constants.ts:4`).

---

## 6. Notifications page

**Page** `/dashboard/notifications` (`app/dashboard/notifications/page.tsx` +
`NotificationsView.tsx`): redirects non-users to `/login`; heading shows "N unread" /
"All caught up"; "Mark all read" button disabled when none; tab strip appears only when the
first page loaded and is non-empty (`:130`); tabs from `lib/notifications-tabs.ts`: **Likes
and comments / Events / Jobs / Other** with per-tab unread pills (9+ cap) derived from the
loaded page (`:100-103,158-165`). Rows show icon per type, title, relative time (now/<m/<h/
<d), optional body, a red dot + tinted bg when unread, and a "View job" affordance for
`job_match` (`:220-266`).

**Types** (`lib/notifications.ts:24-40`): `thread_comment`, `thread_reply`, `thread_like`,
`resource_comment`, `resource_reply`, `event_comment`, `event_reply`, `event_rsvp`,
`thread_deleted`, `showcase_deleted`, `resource_deleted`, `event_deleted`,
`report_reviewed`, `content_restored`, `job_match`, `join_request_accepted`.
Community broadcasts and chat @mention notifications were removed (migration
`20260915120000_remove_broadcast_and_mention_notifications.sql`; comment `:13-22`).
Tab mapping (unclaimed types are hidden entirely, `notifications-tabs.ts:48-76`):
- activity: thread_like, thread_comment, thread_reply, resource_comment, resource_reply
- events: event_comment, event_reply, event_rsvp
- jobs: job_match
- other: the four `*_deleted`, report_reviewed, content_restored, join_request_accepted

**Navigation targets** (hrefs are stored on the row; helpers in `lib/notifications.ts:254-276`):
threads → `/dashboard/communities/<cid>/threads/<tid>`, showcase → `…/showcase/<sid>`,
resources → `…/resources/<rid>`, events → `…/events/<eid>`; removals link to the community
itself (the deep target is gone); join_request_accepted → `/dashboard/communities/<cid>`;
job_match → the job page (see `lib/jobs/notifications.ts`).

**API** `GET /api/notifications` (`app/api/notifications/route.ts:8-44`): latest **30**
(newest first), fields `id,user_id,actor_id,community_id,type,entity_type,entity_id,title,
body,href,metadata,read_at,created_at`; plus `unread_count` (exact count of `read_at is
null`). No pagination beyond 30 (the client caps its realtime prepends at 30 too,
`lib/use-notifications.ts:67`). `PATCH {id}` / `PATCH {all:true}` — scoped by `user_id`,
sets `read_at=now`, publishes `update` (or one per row for all) to
`notifications:<uid>` so other tabs sync (`:46-165`).

**Realtime** (client `lib/use-notifications.ts:202-275`): room `notifications:<uid>` on the
user socket; topics `insert` (prepend + unread+1; payload flat row), `update`
(`{next,old}` envelope — decrement only when `old.read_at null → next.read_at set`), and a
client-handled `delete` that **nothing currently publishes**. Creation side:
`create_notification` RPC atomically inserts or aggregates into the existing unread row for
`(user_id, entity_type, entity_id)`; the publish uses `inserted` to choose `insert` vs
`update` (`lib/notifications-realtime.ts:42-88`). Self-actor notifications are skipped
(`lib/notifications.ts:173`); titles ≤160, bodies ≤500.

**Badge / watermark rule (project memory confirmed):** the bell badge shows `unseenCount` =
unread notifications whose `created_at` is **strictly newer than the last-open watermark**;
the watermark is the newest notification's own `created_at` persisted per user in
localStorage key `uxcommunity:notifications:seen:<uid>` (monotonic; module mirror shared
across hooks/tabs via `storage` events) (`lib/notifications-seen.ts:18-93`). Before the
member has ever opened the list there is no watermark and the server's total `unread_count`
stands in (`use-notifications.ts:318-321`). Opening `/dashboard/notifications` mounts the
view with `autoMarkSeen:true`, which advances the watermark to the newest loaded item on
every list change **without writing `read_at`** — unread dots, per-tab counts and "Mark all
read" stay exactly as they were (`NotificationsView.tsx:87-92`; `use-notifications.ts:191-200`).
Realtime arrivals while the page is open show up in the list but do not raise the badge;
after leaving, the next arrival counts from one.

**Preference API** — actual method is **GET/PATCH `/api/push/settings`** (not PUT):
- GET (`app/api/push/settings/route.ts:41-106`): `{preferences:{chatPushEnabled,
  communityPushEnabled, chatSound:"default"|"silent", quietHoursEnabled, quietHoursStart
  "HH:MM", quietHoursEnd, quietHoursTimezone (IANA or UTC), emailJobUpdates,
  emailCommunityActivity, emailProductNews}, mutedCommunityIds:[uuid],
  unreadCount: number}` — defaults filled for members with no row (chat on, community on,
  sound default, quiet hours off 22:00–07:00 UTC, email true/true/false).
- PATCH (`:108-259`): partial update; booleans validated (422), `quietHoursStart/End` must
  be `HH(:MM)` (stored `HH:MM:00`), timezone must be a valid IANA name; `mutedCommunityIds`
  must be an array of strings — semantics are **declarative**: unmute every membership of
  the caller, then mute exactly the listed ids (guessed ids simply match nothing).
- The Settings page `/dashboard/settings/notifications` renders these toggles (server page
  under `app/dashboard/settings/notifications/page.tsx`).

---

## 7. Push notification backend

### 7.1 Devices — `/api/push/register` (`app/api/push/register/route.ts`)
- `POST {token, platform}` — token must match `/^Expo(nent)?PushToken\[.+\]$/` else 422,
  platform `ios|android` else 422; upsert on token PK (`push_tokens.token`) so a
  logout→login on the same device re-points the row instead of leaking the old account's
  chats (`:13-61`).
- `DELETE {token}` — deletes the caller's own row only (`:69-92`); called on logout.
- `POST /api/push/test` — sends a push to the caller's own tokens and reports Expo's
  per-message answer with hints for `InvalidCredentials`/`MismatchSenderId`/
  `DeviceNotRegistered` etc. (`app/api/push/test/route.ts:16-60`).

### 7.2 Community message push (`lib/push/chat.ts`, fired from the message route's `after()`)
- Trigger: every successful community chat send (`announceNewChatMessage` →
  `sendChatMessagePush`, `lib/communities/message-publish.ts:87-117`). **Nothing is written
  to `notifications`** for chat on purpose (`push/chat.ts:324-334`).
- Recipients: keyset-paged `community_members` chunks of 500, ordered `user_id`, excluding
  the sender (`neq user_id`) and muted memberships (`notifications_muted=false` AND
  (`notifications_muted_until` null or `<= now`)), with every read chunk-scoped
  (`push/chat.ts:449-543`). Members with no `push_tokens` rows are dropped early.
- Per-member gates: no `notification_preferences` row ⇒ defaults (chat on);
  `chat_push_enabled=false` ⇒ skipped entirely (`:575-577`); quiet hours or
  `chat_sound="silent"` ⇒ **silent** push (still lands, `sound:null`, channel
  `messages-silent`); audible budget: max **3 buzzing pushes per (user, community) per
  60 s** window (`AUDIBLE_MAX=3`, `AUDIBLE_WINDOW_MS=60_000`, `lib/push/preferences.ts:32-33,
  58-67`); only audible pushes consume the budget (`:583-604`).
- Payload per device token (`chat.ts:606-627`):
  ```
  { to, title: <community name>,
    body: `<senderName|Someone>: <preview ≤120 chars | "Sent a photo" | "Replied…">`,
    sound: "default" | null, channelId: "messages" | "messages-silent",
    badge: <total unread chat messages across ALL communities>,
    collapseId: `community-<communityId>`,
    data: { type: "community_message", communityId, messageId, badge, silent: !audible } }
  ```
- Badge query: `loadUnreadMessageTotals(userIds)` wraps SQL `get_unread_message_totals`
  (mirrors `get_sidebar_activity`'s unread definition so badge == app count), chunked 300
  members/call (`lib/push/unread-totals.ts:33-65`).
- Guardrails: `PUSH_MAX_DELIVERIES=10_000` device pushes and `PUSH_TIME_BUDGET_MS=20_000`
  per message; delivery at-least-once (`sendExpoPushBatches` retries, collapseId collapses
  duplicates); receipts checked ~1.5 s after the fan-out within the same budget
  (`PUSH_RECEIPT_GRACE_MS`); dead tokens (`DeviceNotRegistered`) deleted in batches of 200;
  structured report `ChatPushReport` (`chat.ts:83-107,235-278,730-783`).

### 7.3 Join-request-accepted push (`lib/push/membership.ts`)
Called deferred from the accept route; single recipient;
respected prefs: **`community_push_enabled`** (not `chat_push_enabled`), quiet hours (silence),
sound (`lib/push/membership-preferences.ts:39-49`); no audible budget. Payload:
`{title:"Your request to join was accepted", body:"You're now a member of <name>. Open the
community to say hi.", sound, channelId, collapseId:`membership-<cid>`, data:{type:
"join_request_accepted", communityId, href:"/dashboard/communities/<cid>"}}`
(`membership.ts:96-110`). Failures are logged and swallowed.

---

## 8. Realtime rooms & topics (critical for mobile)

Worker: `apps/realtime/src` (Cloudflare Worker + Durable Objects). Routing contract:
`apps/realtime/src/room-routing.ts`. Client room helpers (must stay in sync):
web `apps/web/lib/realtime/rooms.ts`, mobile `expo-app-standalone 3/lib/realtimeCore.ts:216-229`.

**Socket model**
- One WebSocket per **community-scoped** room, connected directly to that community's
  `Room` DO; ONE WebSocket per user (`user:<userId>` instance of `UserDO`) carrying every
  **user-scoped** logical room (`apps/web/lib/realtime/client.ts:67-72,493-502`).
- `USER_ROOM_PREFIXES = ["notifications:", "profile:", "dm:"]` (`room-routing.ts:45`);
  publishing to `dm:<uid>` routes to the recipient's `user:<uid>` DO while the event body
  keeps the logical room name for subscription filtering (`room-routing.ts:59-99`).
- WS auth: session JWT from the `uxcommunity_session` cookie (or legacy name), or a
  `?token=` query param fallback; `isUserScopedRoomAllowed` forces `user:`/`notifications:`/
  `profile:`/`dm:` rooms to the caller's own id (403 otherwise)
  (`apps/realtime/src/index.ts:138-175`). Community-room sockets additionally pass a
  fail-closed membership check inside the DO (`apps/realtime/src/room.ts:187-204`;
  `membership-auth.ts`).
- Client-publish boundary: **only topic `typing`** may be published over a member's socket,
  payload keys `{typing,user_id?,name?,ts?}`, identity stamped server-side; per-socket
  bucket 12 burst/4 per s, per-user 24 burst/8 per s (`apps/realtime/src/client-publish.ts:41-175,72-84`).
  Everything else (chat messages, DM events, notifications) is server-authored through the
  secret-authenticated `POST /publish` path (`apps/web/lib/realtime/publish.ts`), which
  retries transient failures and carries a stable `event_id` that the DO dedupes
  (`room.ts:441-455`).

**Room names** (`apps/web/lib/realtime/rooms.ts:6-20`):
| Logical room | Owner DO | Used by |
|---|---|---|
| `chat:<communityId>` | CommunityDO | community chat messages/edits/deletes/reactions/typing/content events/retention |
| `presence:<communityId>` | CommunityDO | presence count frames (same socket as chat) |
| `threads:<communityId>`, `thread-comments:<threadId>` | CommunityDO | threads feature (out of scope) |
| `events:<communityId>`, `resources:<communityId>`, `resource-comments:<resourceId>` | CommunityDO | events/resources features |
| `showcase:<postId>` | CommunityDO | showcase posts |
| `rules:<communityId>` | CommunityDO | community rules INSERT/DELETE |
| `notifications:<userId>` | UserDO (`user:<uid>`) | notification list/badge |
| `profile:<userId>` | UserDO | profile updates |
| `dm:<userId>` | UserDO (`user:<uid>`) | ALL DM traffic for that user |

**Topics & payloads**

`chat:<communityId>` (subscriptions seen in `useRealtimeChat.ts`, `useTypingPresence.ts`,
`useOnlinePresence.ts`):
- `message` — `{id, community_id, user_id, sender_name, sender_avatar_url, content,
  created_at, reply_to_id, reply_sender_name, reply_to_content_id, reply_content_kind,
  reply_content_title, image_url, mentions:[{user_id,name}]}` (`lib/communities/message-publish.ts:87-107`).
  Sent to every subscribed socket (no exclude); sender's other tabs dedupe by id.
- `message-edit` — `{id, content, edited_at}`.
- `message-delete` — `{id, deleted_at, deleted_by, deleted_by_role|null}`.
- `reaction-insert` — `{community_id, message_id, user_id, emoji}`.
- `reaction-update` — `{old:{…emoji}, new:{…emoji}}`.
- `reaction-delete` — `{community_id, message_id, user_id, emoji}`.
- `messages-expired` — `{cutoff}` (retention sweep; clients prune cache).
- `typing` — client-published; broadcast shape `{user_id, name|null, typing}` (identity
  stamped; per-socket recipient set = topic subscribers).
- `thread-insert|thread-update|thread-delete`, `content-insert|content-delete`,
  `content-reaction-insert|update|delete`, `content-comment` — timeline "created a …"
  cards (server-authored).
- presence frames are not topic events: the DO sends `{t:"presence", count}` to all sockets
  in the room (coalesced, see `apps/realtime/src/presence.ts`).

`dm:<userId>` (both participants receive every event; topics in `useDmRealtime.ts`,
`useDmUnreadBadge.ts`, `lib/direct-messages/publish.ts`):
- `dm-message` — `{id, conversation_id, participants:[a,b], user_id, sender_name,
  sender_avatar_url, content, created_at, reply_to_id, reply_sender_name, image_url}`
  (`app/api/dm/conversations/[id]/messages/route.ts:367-383`).
- `dm-request-update` — `{conversation_id, request_state:"pending"|"accepted"|"rejected",
  requested_by}` (published on first-message requester assignment, implicit accept, and
  accept/reject).
- `dm-message-edit` — `{conversation_id, id, content, edited_at}`.
- `dm-message-delete` — `{conversation_id, id, deleted_at}`.
- `dm-reaction-insert` — `{conversation_id, message_id, user_id, emoji}`;
  `dm-reaction-update` — `{old:{…}, new:{…}}`; `dm-reaction-delete` — `{conversation_id,
  message_id, user_id, emoji}`.
- `dm-typing` — `{conversation_id, user_id, name, typing, ts}`.

`notifications:<userId>`:
- `insert` — the flat notification row `{id,user_id,type,title,body,href,read_at,created_at}`
  (also carries actor/community/entity ids in the DB but the flat insert payload omits them,
  `lib/notifications-realtime.ts:46-63`).
- `update` — `{next:<full row incl. actor_id, community_id, entity_type, entity_id,
  metadata>, old:{id, read_at}}` (`:65-88`); also emitted per row by the mark-read PATCH.
- `delete` — handled by the client (`use-notifications.ts:256-267`) but currently nothing
  publishes it.

**Delivery guarantees**: durable events are recoverable from the DB (client catch-up on
reconnect / visibility / next page load); `typing` and presence are ephemeral (dropped on
send failure, no retry) (`apps/realtime/src/room.ts:60-64`). DO dedupes by `event_id`;
publisher retries ≤3 with jittered backoff (`lib/realtime/publish.ts:32-35,54-97`).

**Mobile constraints found (must-fix for DM/notification parity):**
1. `expo-app-standalone 3/lib/realtimeCore.ts:189` — `USER_ROOM_PREFIXES = ['notifications:',
   'profile:']`; missing **`dm:`** (server has it in `room-routing.ts:45`). Consequences:
   `userRoomOwner('dm:<uid>')` returns null, so `forgetOtherUsersRooms` never clears DM
   rooms on an account switch (`realtimeCore.ts:362-375`), and any code that validates
   user-scoped rooms will not recognise DM. Because `dm:` is also absent from
   `COMMUNITY_ROOM_PREFIXES` (`:169-177`), DM subscriptions would accidentally ride the
   user socket — correct instance, but the prefix set must still be extended for account
   hygiene and parity.
2. `realtimeCore` `realtimeRooms` has no `dm` helper (`:216-229`) — add
   `dm: (userId) => 'dm:' + userId`.
3. Web client treats the session cookie as the socket credential; mobile replays
   `uxcommunity_session` from AsyncStorage as a handshake header (`lib/realtime.ts:48-84`)
   — already correct for `dm:`/`notifications:` rooms.

---

## 9. Cross-cutting edge-case inventory (quick reference)

- **Logged out:** Explore page and API 401; community page server-redirects to `/login`
  (`communities/[id]/page.tsx:19`); messages page to `/login` (`messages/page.tsx:18`);
  notifications page to `/login`; invite landing page renders (GET public) but POST 401 and
  its redirect currently breaks (§2.5); DM routes 401.
- **Non-member:** community page shows read-only `CommunityPreview`; chat/message routes
  403 ("Not a member of this community."); `members/[userId]` GET 403; mute 403; rules GET
  allowed (any logged-in user); `?peer=` DM always allowed (no membership concept).
- **Pending private request:** Explore card "Request sent"/"Withdraw"; join POST idempotent;
  accept → membership + notify; decline → silent, card reverts after re-request deletes the
  declined row; at 7 slots a *pending* request counts against the cap and a new
  request/acceptance is 429.
- **Muted:** no push (chat fan-out filters), browser/sidebar badge still increments
  (mute ≠ read); effective until the stored deadline compares past; "Always" flag separate.
- **Blocked (DM):** blocker loses the conversation from the list, blocked keeps history;
  both directions cannot insert; edits/deletes of old rows still work; profile reduces;
  reports still possible from the blocked side? (report route only checks participation —
  neither direction is blocked from reporting).
- **Rate limits:** chat/DM send 5/10 s + 20/60 s; DM create 30/60 s; DM typing 8/10 s;
  DM request answer 30/60 s; DM block 10/60 s; DM report 5/60 s; Explore/join/read/mute
  routes have no rate limiter (DB triggers + caps are the backstops).
- **Creation caps (DB `creation_limits`, migration `20261013120000`):** `posts_daily` 3,
  `events_monthly` 1, `jobs_monthly` 1, `dms_monthly` 5 new conversations/month,
  `communities_total` 1 lifetime, `community_joins` 7 standing (live memberships only; event
  chats excluded; counters never refund except standing joins). Errors are `limit:<kind>`
  mapped by `lib/creation-limits.ts:11-27`.
- **Deleted content:** chat/DM deletions are soft tombstones with content wiped; retention
  (community chat only) is a hard delete after 15 days; community delete is `is_active=false`
  (last-member leave is a hard delete); DM conversation rejection removes it from both
  lists but keeps rows.
- **Pagination:** Explore list unpaginated (RPC); members 30/page; community chat 50/page
  (compound cursor both directions); DM messages 50/page (compound cursor); notifications 30
  page-1-only; DM conversation list limit 200 rows.
- **Empty states:** Explore "No communities found"/"No pending requests"; DM pane "No
  conversations yet — Start one from any member profile."; notifications per-tab empties;
  community preview/404 state.
