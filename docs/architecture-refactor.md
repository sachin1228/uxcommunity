# Architecture Refactor — Assessment & Report

Scope: `apps/web` (Next.js app, 129 `app/api` route handlers, ~50 `lib/communities`
modules), `apps/realtime` (Cloudflare Durable Object fan-out), `packages/shared`,
`packages/design-system`, `supabase/`, `k6/`, and the standalone Expo app.

All paths are current as of the 2026-09-26 verification. The "before" columns in
the tables name pre-refactor locations on purpose — they are the historical record
of what moved, not stale references.

Refactoring principle: **responsibility boundaries and dependency direction
first, line count second.** No product behaviour, API contract, schema,
realtime protocol, or UI was changed.

## Baseline (before any change)

| Check | Result |
| --- | --- |
| `tsc --noEmit -p apps/web` | clean |
| `eslint apps/web` | 65 problems (43 errors, 22 warnings), all pre-existing |
| `npm run test:*` (38 tsx suites) | 374 / 374 passing |

---

## 1. Assessment

### P0 — critical architecture problems

| File | Current responsibility | Problems | Risk | Recommended change |
| --- | --- | --- | --- | --- |
| `lib/communities/read-manager.ts` → `components/communities/panel/markReadOnServer.ts` | Client read-state manager | `lib/` imported **runtime code** from `components/`: the dependency pointed the wrong way (domain → UI). | Hidden cycles; UI refactors break domain logic. | Move `markReadOnServer` into `lib/communities/mark-read.ts`. **Done.** |
| `components/communities/{events,threads,resources}/types.ts` | Domain models + constants (`THREAD_CATEGORIES`, `RESOURCE_TYPES`, poll limits) | Server route handlers, `lib/communities/event-cards.ts`, `event-chat.ts`, and `lib/threads/load-thread-detail.ts` imported domain types from the UI layer. | Server code coupled to component folder layout. | Move to `lib/communities/models/*`. **Done.** |
| `components/communities/CommunityChat.tsx` (1,700 lines) | Chat page shell | One component held tab routing, SSR cache seeding, bootstrap priming, the content-card timeline, two reaction coordinators, drafts, editing, scroll anchoring, lightbox, permissions, and render. 17 effects, 15 `useState`. | Hard to reason about; regressions hide in effect ordering. | Extract the separable concerns into hooks. **Partly done** (see §2). |

### P1 — important

| File | Problems | Recommended change |
| --- | --- | --- |
| 5 route handlers (`events`, `resources`, `resources/[id]/comments`, `threads`, `threads/[id]/comments`) | Each defined an **identical** private `isMember()`; `read-models.ts` had a third copy as `isCommunityMember`. | One `lib/communities/membership.ts`. **Done.** |
| `components/communities/chat/MessageBubble.tsx` (1,209) | Rendering, hover actions, reaction pills, link previews, and media in one file. | Split by UI concern (actions menu, reactions row, media). Needs visual QA — **deferred**. |
| `lib/realtime/client.ts` (811) | Connection lifecycle, reconnect/backoff, room ref-counting, and event dispatch in one module. | Separate the connection state machine from room subscription bookkeeping. Needs WS integration testing — **deferred**. |
| `components/communities/chat/useSendMessage.ts` (790) | Optimistic send, retry/cancel, image upload, GIF send, and scroll pinning. | Extract upload pipeline from the send-queue. **Deferred.** |
| `lib/communities/cache.ts` (771) | Module-level stores (`sidebarStore`, `metaCache`, `msgCache`), reaction projection helpers, sidebar patchers, and DOM-event registries. | Split pure reaction projection (`applyReactionInsert/Delete`) from store state. **Deferred.** |
| ~40 other inline `community_members` lookups in `app/api` | Most select extra columns (`role`, permissions), so they are not the same query. | Consolidate into role-aware helpers in `membership.ts` route by route. **Deferred**, but the module now exists for them. |

### P2 — worthwhile cleanup

| File | Problem | Status |
| --- | --- | --- |
| `CommunityChat.tsx` | `(displayCommunity as any)?.current_user_role` — `as any` because the local `Community` type in `useChatData.ts` lacked fields the runtime object carries. | Typed properly. **Done.** |
| `CommunityChat.tsx` | Dead code: `handleContentCreated`, `handleContentDeleted` (never referenced); unused `realtimeClient`, `realtimeRooms`, `usePathname`, `fetchAndHydrateCommunityBootstrap` imports. | Removed. **Done.** |
| `CommunityChat.tsx` | Five copies of the same `next/dynamic` loading fallback. | Single `TabLoading` component. **Done.** |
| `useChatData.ts` `Community` vs `CachedMeta["community"]` | Two hand-maintained shapes for the same row. | Derive one from the other. **Deferred** (touches many call sites). |
| 65 lint findings (`set-state-in-effect`, `no-img-element`, …) | Pre-existing. | Fix per file alongside behaviour tests. **Deferred.** |

### P3 — optional

- `lib/` root has ~50 flat files mixing client hooks (`use-*.ts`) and server helpers; grouping by domain would help discovery.
- `apps/realtime/src/room.ts` (666) is coherent today; revisit only if fan-out logic grows.

### State ownership (chat surface)

| State | Owner | Writers | Readers | Lifetime / invalidation |
| --- | --- | --- | --- | --- |
| `msgCache` / `metaCache` | `lib/communities/cache.ts` (module) | `useChatData`, `useContentTimeline`, `useChatReactions`, realtime | chat hooks, sidebar | Session; `evictIfNeeded`, `invalidateOnLeave` |
| Request cache entries | `lib/request-cache.ts` | `seedCommunityRequestCache`, fetchers, `mark-read` | tab views | Per user; stale windows per endpoint |
| Content-card timeline | `useContentTimeline` (React state) | tab callbacks, `useLocalContentEventMirror`, `useRealtimeChat`, reactions | `MessageList` | Reset on community switch |
| Active tab | `useCommunityTabs` | header, `popstate` | page | URL (`?tab=`) is the source of truth on load |

No duplicated source of truth was introduced; the extraction only moved existing owners.

---

## 2. Refactor Summary

**Files changed:** 45 · **Files added:** 5 · **Files moved:** 4 · **Files removed:** 0

### Major problems found

1. Domain layer (`lib/`) and server routes depended on the UI layer (`components/`).
2. A 1,700-line page component owning half a dozen unrelated responsibilities.
3. The same membership query copied into six places.

### Major refactors

1. **Dependency direction.** Domain models moved to `lib/communities/models/{events,threads,resources}.ts`; `markReadOnServer` moved to `lib/communities/mark-read.ts`. After this, `grep "@/components" lib app/api` returns nothing.
2. **`CommunityChat.tsx` 1,700 → 1,254 lines.** Extracted:
   - `chat/useCommunityTabs.ts` — active tab + `pushState`/`popstate` sync.
   - `chat/seedCommunityRequestCache.ts` — pure function that seeds first-page endpoints from the SSR snapshot.
   - `chat/useContentTimeline.ts` — thread/content card state, readiness flags, bootstrap priming, reaction merge; plus `useLocalContentEventMirror` for same-tab creates/deletes.
   - `chat/useChatReactions.ts` — both `ReactionIntentCoordinator` maps (messages and content cards) with a shared `persistReaction` request helper.
3. **Membership gate.** `lib/communities/membership.ts#isCommunityMember(communityId, userId, db?)` replaces six copies; routes pass their existing service client, so there are no extra client allocations.

### Architecture after refactor

```text
app/api/*            request parsing, auth, response  ──▶ lib/communities/*
components/*         UI + UI-orchestration hooks      ──▶ lib/*
lib/communities/models/*   domain types & constants (no deps on components)
lib/communities/membership.ts   authorization data access
```

`CommunityChat` now wires hooks together and renders. Timeline, reactions, and
tab routing each have one owner with explicit inputs.

### Important decisions

- **Effect order preserved.** Hooks are called where the inlined code used to be, so passive and layout effects still register in the same relative order. The scroll-anchor compensation and draft-restore effects were **deliberately left inline**: they interleave with `useScrollAndUnread`'s layout effects, and moving them would reorder effects in a way that needs in-browser scroll QA.
- **No shim re-exports** for moved types; every importer was updated so there's one canonical path.
- **Permissions read from `community`, not `displayCommunity`.** They behave the same: the sidebar fallback never carries role/permissions, so the old `as any` read was always `undefined` for it.
- **No schema, RPC, realtime-protocol, or response-shape changes.**

### Validation

| Check | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | clean |
| Lint | 65 → 65; per-file diff identical (no new findings) |
| Tests (38 tsx suites) | 374 / 374 passing |
| `next build` | succeeds |
| Supabase SQL tests / realtime vitest | not run (need a local Supabase / Wrangler); no files in those areas changed |

### Remaining technical debt

1. `MessageBubble.tsx`, `useSendMessage.ts`, `lib/realtime/client.ts`, and `lib/communities/cache.ts` are still 750–1,200 lines each (see P1).
2. Scroll anchoring and draft persistence are still inline in `CommunityChat.tsx`; extract them together with a browser scroll regression test.
3. Role-aware `community_members` lookups are still inlined across ~40 routes.
4. 65 pre-existing lint findings.

### File table

| File | Before | After | Reason |
| --- | --- | --- | --- |
| `components/communities/CommunityChat.tsx` | 1,700 lines, 17 effects | 1,254 lines | Extracted tabs, SSR seeding, timeline, reactions; removed dead code and `as any` |
| `components/communities/chat/useCommunityTabs.ts` | — | 49 | Tab ↔ URL sync |
| `components/communities/chat/seedCommunityRequestCache.ts` | — | 57 | Pure SSR → request-cache seeding |
| `components/communities/chat/useContentTimeline.ts` | — | 256 | Content-card timeline owner |
| `components/communities/chat/useChatReactions.ts` | — | 223 | Optimistic reaction coordinators |
| `components/communities/chat/useChatData.ts` | `Community` missing role fields | typed | Removes the need for `as any` |
| `lib/communities/membership.ts` | 6 copies | 1 module | Single membership gate |
| `lib/communities/mark-read.ts` | `components/communities/panel/markReadOnServer.ts` | moved | lib must not depend on components |
| `lib/communities/models/{events,threads,resources}.ts` | `components/communities/*/types.ts` | moved | Domain types belong to the domain layer |
| 5 API routes + `event/route.ts` | local `isMember` | `isCommunityMember` | Deduplicated authorization |
| ~30 importers | old type paths | `@/lib/communities/models/*` | Follow the move |
