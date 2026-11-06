# Stage 2 — Security Hardening Implementation Report

**Date:** 2026-11-06
**Branch:** `security/stage-2-hardening`
**Base:** `main` @ `c5926c80`
**Audit:** the 2026-11 overall repository audit (PR #794).
**Scope:** AUD-05, AUD-06, AUD-07, AUD-08, AUD-10, AUD-49, AUD-50.
**Constraint:** No production data, infrastructure, credentials or deployments were touched. Nothing was deployed.

---

## 1. Executive summary

Seven security findings from the 2026-11 audit were implemented. Four are fixed and verified locally; three are implemented and require live/staging or device verification (R2 object metadata, a generated Android build, and real FCM delivery). No production access was used.

The most important change is **AUD-50**: a removed community member's open WebSocket is now closed immediately (close code `4003`) in every room belonging to that community, while their other communities, DM socket and session remain alive. Before this change, membership was checked only at handshake, so a removed member could keep reading a private room until the socket disconnected.

The second is **AUD-05**: auth/abuse-sensitive rate limits now fail **closed** when Upstash is missing in production, and use a bounded per-isolate fallback (logged as degraded) during a transient Redis timeout/5xx/quota. The global page-load guard and two low-risk reads remain availability-oriented.

No security assertion was weakened to make a test pass. Two stale test fixtures were corrected because the product behaviour they asserted was already correct: the realtime revocation suite's `.dev.vars` parser kept surrounding quotes from generated values, and the fail-closed test expected 401/403 while the Worker's configuration guard now returns a clearer 503.

## 2. Findings addressed

| Finding | Priority | Status | What was done |
|---|---|---|---|
| **AUD-05** Rate limiting fail-open | P1 | **FIXED AND VERIFIED** | Added `strict` (default) and `availability` modes. Production missing Upstash config fails closed; timeout/5xx/quota use a bounded per-isolate fallback with a 1.5 s Redis deadline and structured `rate_limit.degraded` logs. Global middleware, `/api/auth/me` and DM typing opt into availability. Added runtime tests and a static route audit. |
| **AUD-06** `javascript:` profile URLs | P1 in sprint | **FIXED AND VERIFIED** | Added `lib/security/safe-url.ts` and `lib/profile/urls.ts`. `PATCH /api/profile` now rejects non-http(s), credentialed, malformed and overlong links with 422; LinkedIn must be on `linkedin.com`. Admin user card and admin verification page render through `safeExternalUrl`; public profile reuses the same helper; Zod URL fields require http(s). Added unit tests. |
| **AUD-07** Presigned upload size/ownership | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | A claim-based finalize state machine: one atomic claim per ticket, a random claim token + lease, a claim-specific final key, staging/copy ETag comparison, and a token-guarded commit. A losing/late finalize cannot commit or overwrite the winner; a concurrent staging PUT between HEAD and copy changes the ETag and is rejected before commit. Finalized retries return the committed attachment; a lost commit response is resolved by re-reading the stored final key. Unit tests cover ownership, reuse, expiry, size/type/ETag mismatch, claim-key isolation and lost-commit resolution; SQL tests cover claim/lease/release/commit races and pass in CI. Live R2 ETag/copy behaviour and the staging apply remain. |
| **AUD-08** Push after implicit sign-out | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | `createSignOutCoordinator` now detaches the push token before clearing the session cookie, bounded by the existing 2.5 s timeout; explicit logout already did this. The Android FCM service drops messages when the native signed-in user is null and drops a direct message whose `recipientId` differs; the JS foreground handler suppresses presentation/badges when signed out. Unit tests pass; real-device FCM and a rebuilt APK remain. |
| **AUD-10** Android backup | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | `android.allowBackup: false` in `app.json` plus `plugins/withAndroidBackupPolicy.js`, which also sets `fullBackupContent`/`dataExtractionRules` and writes exclusion rules for every app-data domain on prebuild. A source-of-truth test asserts both. A regenerated manifest/APK remains to be inspected on a device. |
| **AUD-49** Server-side socket limits | P1 in sprint | **FIXED AND VERIFIED** | Added per-user (default 12) and per-session (default 8) caps in the Room DO, oldest-socket eviction (close `4008`), a per-member upgrade token bucket, a production-only per-IP handshake damper (1,200 burst / 200 per second, sized for a shared NAT), optional env overrides, and metrics. Tests prove caps/eviction, reconnection, 3 devices × 2 tabs staying connected, and 50,000-socket fan-out. |
| **AUD-50** Membership removal socket revocation | **CRITICAL** | **FIXED AND VERIFIED** | A community-scoped revocation path (web → `/revoke` with `communityId` → UserDO filters its registered rooms → Room DO closes that user's sockets with `4003`) plus a durable Postgres queue. The membership delete, moderator-grant delete and queue insert are one atomic SQL RPC, so a crash cannot lose the revocation. A minute cron drains failed closes with exponential backoff (15 s → 1 h), revalidates membership first (a rejoined member is not disconnected), and is generation-guarded so a stale processor cannot complete a later removal. Integration tests prove room isolation and idempotence; unit tests prove failure → backoff → recovery. |

## 3. Findings not addressed

These are outside this sprint's scope and remain as reported in the audit:

- AUD-01 backup/DR, AUD-02 credential rotation, AUD-03 Android release signing/versioning, AUD-04 release-gate coverage.
- AUD-09 mobile request timeouts.
- AUD-11 web error boundaries, AUD-17 durable push queue, AUD-18 durable realtime replay, AUD-19 CSP/cookie, AUD-20 error tracking.
- AUD-23 service-role-only DB access, AUD-29 push token reassignment (accepted design), AUD-30 internal timing-safe compares, and the remaining P3 items.

The Stage 2 prompt's "additional security checks" were inspected. No new verified vulnerability was found that justified an unrelated change. AUD-29 (token reassignment) remains a documented risk: the register endpoint intentionally re-points a token on logout → login, and the DELETE endpoint is scoped to the caller's `user_id`.

## 4. Exact files modified

**Web**
- `apps/web/lib/auth/rate-limit.ts`, `rate-limit.test.ts`
- `apps/web/lib/auth/rate-limit-route-audit.test.ts` (new)
- `apps/web/lib/global-request-rate-limit.ts`
- `apps/web/app/api/auth/me/route.ts`
- `apps/web/app/api/dm/conversations/[id]/typing/route.ts`
- `apps/web/app/api/profile/route.ts`
- `apps/web/lib/profile/urls.ts` (new), `apps/web/lib/security/safe-url.ts` + test (new)
- `apps/web/app/dashboard/profile/components/ProfileCard.tsx`
- `apps/web/components/admin/users/UserInfoCard.tsx`
- `apps/web/app/admin/(protected)/verifications/page.tsx`
- `apps/web/lib/validations.ts`
- `apps/web/lib/r2.ts`
- `apps/web/app/api/communities/[id]/showcase/upload-ticket/route.ts`
- `apps/web/app/api/communities/[id]/showcase/upload/route.ts`
- `apps/web/lib/video/upload-guard.ts` + test
- `apps/web/lib/realtime/revoke.ts` + test (new)
- `apps/web/lib/realtime/membership-revocation-queue.ts` + test (new)
- `apps/web/app/api/internal/membership-revocations/process/route.ts` + test (new)
- `apps/web/app/api/communities/[id]/members/route.ts`
- `apps/web/app/api/communities/[id]/members/[userId]/route.ts`
- `apps/web/app/api/communities/[id]/events/[eventId]/rsvp/route.ts`
- `apps/web/lib/communities/event-chat.ts` (leave result distinguishes removed/owner/failed)
- `apps/web/lib/supabase/database.types.ts` (new table/columns/functions; regenerate after applying migrations)

**Mobile**
- `expo-app-standalone 3/app.json`
- `expo-app-standalone 3/context/AuthContext.tsx`
- `expo-app-standalone 3/lib/sessionLifecycle.ts` + test
- `expo-app-standalone 3/lib/chatNotificationState.ts`
- `expo-app-standalone 3/lib/push.ts`
- `expo-app-standalone 3/lib/pushPresentation.ts` + test (new)
- `expo-app-standalone 3/plugins/chat-notifications/ChatFirebaseMessagingService.kt`
- `expo-app-standalone 3/plugins/chat-notifications/ChatNotificationStateModule.kt`
- `expo-app-standalone 3/plugins/withAndroidBackupPolicy.js` (new)
- `expo-app-standalone 3/lib/androidBackupPolicy.test.ts` (new)

**Realtime**
- `apps/realtime/src/index.ts`, `room.ts`, `user.ts`, `room-routing.ts`, `metrics.ts`, `env.ts`
- `apps/realtime/src/socket-limits.ts` (new)
- `apps/realtime/src/membership-revocations.ts` + test (new)
- `apps/realtime/__tests__/socket-limits.test.ts` (new)
- `apps/realtime/__tests__/socket-limits.integration.test.ts` (new; caps, reconnection, 3 devices × 2 tabs, membership revocation)
- `apps/realtime/__tests__/room-routing.test.ts`
- `apps/realtime/__tests__/ws-session-revocation.test.ts` (fixture parser)
- `apps/realtime/__tests__/realtime.integration.test.ts` (status assertion: 401/403/503)

**CI / database**
- `.github/workflows/ci.yml` (mobile security tests)
- `.github/workflows/database.yml` (two new SQL tests)
- `package.json` (`test:mobile-security`)
- `supabase/migrations/20261106120000_media_upload_tickets.sql` (new; claim columns + four state functions)
- `supabase/migrations/20261106130000_realtime_membership_revocations.sql` (new; queue + atomic removal RPC)
- `supabase/tests/media_upload_tickets.test.sql` (new; 27 assertions)
- `supabase/tests/realtime_membership_revocations.test.sql` (new; 10 assertions)

## 5. Security changes

### AUD-05 — rate-limit policy
- `rateLimit(key, limit, windowS, { mode })`; default `strict`.
- Production + missing Upstash → strict returns `success:false` with `reason:"missing_config"` (HTTP 429 at the call site; fail closed), availability allows.
- Production + Redis timeout/5xx/quota → strict uses the bounded local window (`degraded:true`, reason), availability allows. The local window is per-isolate and is explicitly not described as distributed.
- Redis calls have a 1.5 s deadline so an outage cannot hold a route open.
- Structured `rate_limit.degraded` event logs only mode, reason, operation prefix, limit and window — never the full key (emails/IPs).
- Global guard and two low-risk reads explicitly use `availability`; a static route audit blocks availability on sensitive prefixes and requires a limiter on critical routes.

### AUD-06 — URL handling
- Only http(s), no embedded credentials, no control characters, ≤2048 chars.
- Linked hosts restricted to `linkedin.com`/subdomains; bare domains get `https://` for form UX.
- Server validates before persistence; every rendering surface re-validates (defence in depth for legacy rows).
- `z.string().url()` replaced with an http(s)-only schema for avatar/image URLs.

### AUD-07 — upload finalize
- Ticket row binds `media_id` → `user_id` + `community_id`, staging key, content type, expected size and expiry.
- Finalize is a claim state machine: `pending` → `claimed` (random token + 120 s lease) → `finalized` or `rejected`. The claim RPC is one atomic `UPDATE`; a second finalize gets 409 while the lease is live. An abandoned claim can be reclaimed after the lease, which changes the token and makes the old claimant's commit fail.
- The winner HEADs the staging object, copies it to a **claim-specific** final key (`media/videos/finalized/<mediaId>/<claimToken>.<ext>`), and HEADs the copy. The copy must match the staging ETag, size and content type before commit; a concurrent PUT that changes staging between HEAD and copy is rejected. Correctness does not depend on a provider-specific conditional-copy header.
- The commit RPC requires the winning claim token. A losing/stale claimant can neither commit nor overwrite the winner; it deletes its own claim-scoped key. The final key is never presigned, so a still-valid staging PUT cannot replace the finalized object.
- A finalized retry returns the committed attachment. If the commit response is lost, the route re-reads the ticket: the stored final key proves whether the commit landed; an ambiguous DB error leaves the claim-scoped object in place rather than deleting a possibly referenced object.
- Rejected/missing/mismatched staging objects are deleted and the ticket is marked rejected; the route deletes staging only after a successful commit.

### AUD-08 — push lifecycle
- Implicit sign-out (401, expiry, realtime 4001, server revocation) detaches the device token before `clearSession`; explicit logout already did.
- The native FCM service drops all messages when `message_cache_user` is null, and drops direct messages for a different `recipientId`.
- The JS handler suppresses banner/list/sound/badge when no authenticated member is active.

### AUD-10 — Android backup
- `allowBackup=false` in Expo source and enforced in the manifest by a config plugin.
- `backup_rules.xml` and `data_extraction_rules.xml` exclude root/file/database/sharedpref/external for both cloud backup and device transfer.
- The plugin is part of the prebuild path, so a future prebuild cannot silently reintroduce the old manifest.

### AUD-49 — socket limits
- Per-user (12) and per-session (8) caps per room, both configurable.
- Oldest matching socket is evicted with `4008` so a reconnection replaces a stale socket rather than being refused.
- Per-member upgrade token bucket (30 burst, 5/s) in the Room DO; production-only per-IP handshake damper (1,200 burst, 200/s) at the Worker, sized for a shared NAT. The IP damper is a burst filter, not the authorization limit.
- Counters: `connectionsEvictedLimit`, `upgradeRateLimited`, `membershipRevocations`, `socketsClosedByMembership`.

### AUD-50 — membership revocation
- Worker `/revoke` accepts a validated `communityId` and routes it to the UserDO.
- UserDO selects only `revoke-room:` entries belonging to that community (`chat:`, `threads:`, `events:`, `resources:`, `rules:`, `showcase:<community>:`), then asks each Room DO to close that user's sockets with `4003`.
- User sockets, DMs, sessions and other communities are untouched. Duplicate requests are safe. The endpoint requires the shared realtime secret; clients cannot call it.
- **Durable delivery:** `remove_community_member_with_revocation(p_community_id, p_user_id)` deletes the moderator grants + membership and upserts a `realtime_membership_revocations` row in **one transaction**. A crash cannot lose the revocation, and a queue row cannot exist for a member who is still in the community.
- After the RPC, the route attempts the immediate close. The immediate call is deliberately close-only; it does not touch the queue row, so it cannot complete a later removal that reopened the same row.
- The realtime Worker's minute cron calls a secret-authenticated internal endpoint that claims up to five due rows. Each row is revalidated against `community_members` first: a member who rejoined is completed without disconnecting their new sockets. A failed close is rescheduled with exponential backoff (15 s → 1 h, capped) and retried indefinitely.
- Queue updates are guarded by the row's `created_at` generation, so a processor that selected an older row cannot mark/reschedule a later removal's row.
- Wired into self-leave (including owner transfer; the last-member community delete cascades the queue row but leaves no room messages), owner/admin removal, and event-chat leave. A definitive "already removed" RPC result is treated as an idempotent success.

## 6. Tests added

- `apps/web/lib/auth/rate-limit.test.ts`: strict missing-config fail-closed; availability missing-config; strict local fallback after a connection failure with limit enforcement; availability availability; development local window; failure classification.
- `apps/web/lib/auth/rate-limit-route-audit.test.ts`: sensitive prefixes stay strict; availability is allowlisted to two routes; critical routes carry a limiter.
- `apps/web/lib/security/safe-url.test.ts`: malicious schemes, credentials, control chars, malformed/overlong, bare domains, LinkedIn host rules, PATCH-body parsing.
- `apps/web/lib/video/upload-guard.test.ts`: valid finalize and every rejection reason (owner, reused, missing, oversized, size mismatch, type mismatch, expired); claim-specific final keys cannot collide; `copiedObjectMatches` rejects a different/absent ETag, size or type; a lost commit response resolves to the stored final key or a retry.
- `apps/web/lib/realtime/revoke.test.ts`: community revocation body/target/auth, 502 retry, missing config.
- `apps/web/lib/realtime/membership-revocation-queue.test.ts`: failure → 15 s backoff, later success, rejoined-member skip, one failed row does not stop the batch, 1 h cap, immediate close is close-only.
- `apps/web/app/api/internal/membership-revocations/process/route.test.ts`: 401 for missing/wrong bearer, 500 when unconfigured.
- `apps/realtime/__tests__/membership-revocations.test.ts`: minute cron posts to the internal endpoint with the API secret, non-2xx/network/config failures return not-ok without throwing.
- `apps/realtime/__tests__/socket-limits.test.ts`: caps, multi-device, reconnection, over-limit cleanup, config clamping.
- `apps/realtime/__tests__/socket-limits.integration.test.ts`: per-user cap eviction, per-session cap eviction, 3 devices × 2 tabs stay connected, reconnect, membership revocation isolation, duplicate revocation, unauthenticated revocation, rejoin after revocation is accepted.
- `apps/realtime/__tests__/room-routing.test.ts`: community-room mapping (including negative/suffix cases).
- `expo-app-standalone 3/lib/sessionLifecycle.test.ts`: implicit sign-out unregisters before clearing the cookie; a failed detach does not block teardown.
- `expo-app-standalone 3/lib/pushPresentation.test.ts`: signed-out/muted/already-reading suppression.
- `expo-app-standalone 3/lib/androidBackupPolicy.test.ts`: Expo config + plugin enforce backup disable and both rule files.
- `supabase/tests/media_upload_tickets.test.sql`: 27 assertions — table/RLS/grants, one live claim, loser cannot commit, stale-lease reclaim, winner key, release/retry, function privileges.
- `supabase/tests/realtime_membership_revocations.test.sql`: 10 assertions — table/RLS/grants, one row per pair, due index, reopen-on-removal, atomic membership delete + queue write, second delete returns false.

## 7. Test execution results

| Check | Result |
|---|---|
| `apps/web: npx tsc --noEmit` | **PASS** |
| Full web unit suite (CI glob, `APP_ENV=production`) | **1,174 / 1,174 pass** |
| `apps/realtime: npx tsc --noEmit` | **PASS** |
| Realtime socket-limit pure + routing | **36 / 36 pass** |
| Realtime socket-limit integration | **6 / 6 pass** (per-user, per-session, 3 devices × 2 tabs, reconnect, membership revocation isolation/duplicate/auth) |
| Realtime session-revocation suite | **6 / 6 pass** |
| Realtime integration suite | **31 / 31 pass** solo (including 50,000/50,000 fan-out). Running this suite concurrently with another miniflare suite produced a false 21,200/50,000 result; run miniflare suites serially. |
| Remaining non-perf realtime suites (21 files) | **239 / 239 pass** (ownership, publish security, multi-device, presence, routing, revocation, retention, retry, dedupe, alerts, sub-entity isolation, membership-revocation cron) |
| `expo-app-standalone 3: npx tsc --noEmit` | **PASS** |
| `npm run test:mobile-security` | **18 / 18 pass** |
| `npm run test:mobile-realtime` | **72 / 72 pass** |
| `node scripts/audit-comments.mjs` | **PASS** (1,605 files, 7 rules) |
| Database workflow `fresh-database` | **PASS** — both new SQL suites ran against the fully migrated fresh schema in CI (run `42168120925`). |
| SQL tests `media_upload_tickets.test.sql`, `realtime_membership_revocations.test.sql` | **PASS in CI**; not run locally (no Docker/local Supabase runtime in this session). |

## 8. Migrations required

Two migrations:

**`supabase/migrations/20261106120000_media_upload_tickets.sql`**
- Creates `public.media_upload_tickets` with FK cascades to `users`/`communities`, unique `media_id`/`staging_key`, expected size, expiry, claim/lease columns, final key/size/poster, rejection and error fields.
- Adds `claim_media_upload_ticket`, `commit_media_upload_ticket`, `release_media_upload_ticket` and `reject_media_upload_ticket`; all `SECURITY DEFINER`, empty `search_path`, `service_role`-only execution.
- Enables RLS, revokes public/anon/authenticated, grants table access to `service_role`, and adds lookup/unique indexes.

**`supabase/migrations/20261106130000_realtime_membership_revocations.sql`**
- Creates `public.realtime_membership_revocations` (one row per user/community, due index, completed/rejected state).
- Adds `remove_community_member_with_revocation`, which deletes moderator grants + membership and upserts the queue row atomically; `SECURITY DEFINER`, `service_role`-only.
- Enables RLS and restricts all access to `service_role`.

The generated Supabase types were updated by hand for both migrations; regenerate them from the migrated local schema before the next generation run. The deploy workflow applies pending migrations before the web Worker, which is the required sequence (see §11). Both migrations are additive and safe to leave in place if the application is rolled back.

## 9. Environment variables / operator actions

- **No new required secret.** The production deploy already requires `UPSTASH_REDIS_REST_URL`/`_TOKEN`; the strict policy now treats their absence as a configuration failure instead of silently disabling limits.
- Optional realtime overrides, all with safe defaults: `ROOM_MAX_SOCKETS_PER_USER` (12), `ROOM_MAX_SOCKETS_PER_SESSION` (8), `ROOM_UPGRADE_BURST` (30), `ROOM_UPGRADE_REFILL_PER_SECOND` (5).
- Operator must run `expo prebuild --platform android --no-install` (or a normal EAS build) so the new backup plugin and native FCM gate reach the generated Android project, then produce a new APK.
- Apply **both** migrations before deploying the web Worker; otherwise video finalize returns 500 and membership removal cannot atomically queue its revocation.
- `20261106120000_media_upload_tickets.sql` was extended in place during the second-pass review (claim columns/functions). If any staging environment applied the earlier revision of that migration, reset that staging database or add an equivalent follow-up migration before deploying; production has **not** applied either revision.
- The realtime Worker's minute cron calls a new internal web endpoint using the existing `API_SECRET`; no new secret is required, but the deploy must push the same `API_SECRET` to both Workers (it already does).
- No production credential rotation is performed by this branch (AUD-02 remains a separate operator action).

## 10. Remaining risks

- **AUD-07 live verification:** the exact-bytes guarantee depends on R2 returning a stable ETag across HEAD and server-side CopyObject for a single-part PUT. Unit tests prove the comparison logic; staging must upload a valid video, an oversized one, a mismatched one, a reused ticket and an unauthorized finalize, and specifically **overwrite staging between HEAD and finalize** and confirm the finalize is rejected. The migration also remains to be applied.
- **AUD-07 orphan claim copies:** a process that crashes after copying to its claim-specific final key but before commit leaves that object unreferenced; a later retry uses a new claim key and cannot overwrite it. The existing R2 orphan/reference sweep is the cleanup path; no dedicated claim-copy purge was added. An ambiguous commit error also leaves the claim-scoped object for a retry to resolve.
- **Upload ticket expiry cleanup:** a ticket that is uploaded but never finalized leaves its staging object until the R2 sweep; no dedicated expiry purge was added.
- **Rate-limit fallback is per isolate:** during a Redis outage the strict routes enforce a local budget per Worker isolate, not a global quota. The log line is actionable and missing configuration is fail-closed, but the fallback is weaker than Redis by design.
- **Rate-limit response:** a missing production configuration returns 429 ("try again"), not 503; the structured log names the configuration failure. Call sites can be refined to 503 in a follow-up.
- **AUD-08 device verification:** the native service and JS handler are unit-tested, but a real APK must prove that a push arriving after revocation is suppressed and that a legitimate multi-device push still renders.
- **AUD-10 device verification:** the config plugin/source test passes; a regenerated manifest and a clean-device backup check are still required.
- **AUD-50 immediate-close/rejoin race:** the immediate close is intentionally not membership-revalidated (that would add a DB round trip to every removal). If a member is re-added within the few milliseconds between removal and the immediate close, that first new socket can be closed; the queue processor revalidates and will not retry, and a subsequent connection is accepted (covered by the rejoin integration test). This is a narrow timing window, not a persistent lockout.
- **AUD-50 recovery window:** the durable queue is drained by a minute cron, at most five rows per tick. If the immediate close fails and the realtime Worker stays up, a removed member's stale socket can receive events until the next tick (bounded by ~1 minute, plus retry backoff if the Worker keeps failing). If the realtime Worker itself is down, no socket receives events; reconnects are membership-checked, and the queue drains after recovery.
- **AUD-50 last-member community delete:** the community delete cascades the queue row, so there is no durable row for that one path. The community and its messages are gone and the immediate close is still attempted; there is nothing left to leak. The room socket may linger until disconnect.
- **Membership revocation scope:** `thread-comments:*` and `resource-comments:*` rooms are not mapped to a community by name. They carry only a `{user_id}` nudge, not comment content, and their sockets are not membership-gated; they are left unchanged. A removed member cannot fetch the comments through the API.
- **Realtime socket caps vs legitimate heavy tab use:** defaults are 12 per user and 8 per session; a miniflare test proves 3 devices × 2 tabs stay connected. Operators can raise the limits via env overrides; the production per-IP damper is 1,200 burst/200 per second and is only a flood damper, not the authorization limit.

## 11. Deployment sequence

1. **Staging:** apply `20261106120000_media_upload_tickets.sql` and `20261106130000_realtime_membership_revocations.sql`; run the SQL tests; deploy the realtime Worker and then the web Worker.
2. **Realtime first:** the new `/revoke` accepts `communityId`, the socket caps and the minute revocation drain. An old web app is unaffected.
3. **Web second:** video finalize now requires a ticket row and the claim RPC. In-flight uploads started before the deploy should be retried by the user. Membership removal now uses the atomic removal RPC and the queue.
4. **Staging verification:** upload/finalize valid + oversized + mismatched + reused + unauthorized; **overwrite staging between HEAD and finalize** and confirm rejection; send two concurrent finalizes and confirm exactly one committed attachment; remove a member from a private community and confirm their socket closes while another community, DM socket and session stay open; **stop/deny the realtime revocation path**, remove a member, verify the queue row remains and the next cron tick closes the socket; rejoin before the tick and confirm the processor does not disconnect the new session; check `/stats` counters; verify login/chat/reset with Upstash healthy and with a simulated Redis outage.
5. **Mobile:** `expo prebuild` / EAS build, install on a device, verify push after implicit sign-out, multi-device push, and that the generated manifest has `allowBackup=false`.
6. **Production:** follow the approved `DEPLOY_PRODUCTION` workflow. Do not deploy production from this branch directly.

## 12. Rollback considerations

- **Web:** reverting the web Worker restores the old upload/profile/rate-limit/removal behaviour. The two new tables can remain without affecting the old code; do not drop them until all clients are on the new finalize path and no ticket/queue rows are in flight.
- **Realtime:** reverting the realtime Worker removes the socket caps, the community-revocation routing and the minute queue drain. The web helper's `communityId` request then receives 400 from the old Worker; membership removal falls back to the previous behaviour (socket remains until disconnect), while session revocation is unchanged. Deploy realtime and web together when rolling back.
- **Mobile:** an older APK ignores the new backup/FCM changes; the server-side push unregister still runs on explicit logout. A new APK is required for the native gate.
- **Database:** keep both migrations applied. Dropping `media_upload_tickets` breaks finalize on the new web code; dropping `realtime_membership_revocations` breaks the atomic removal RPC. If a full rollback is necessary, revert web/realtime first, then drop the objects in a separate approved migration after confirming no references and no pending rows.

---

## 13. Second-pass concurrency review (2026-11-06)

A focused review of PR #795 asked whether the first implementation was actually safe under concurrent finalize/PUT, realtime revocation failure, and multi-device socket use. Three real concurrency defects were found and fixed; the first implementation was not relied on because its tests passed.

### AUD-07 — finalize concurrency findings

| # | Defect found | Fix and evidence |
|---|---|---|
| 1 | **Copy-before-claim race.** The first implementation HEADed staging, copied to a single final key, and only then claimed `finalized_at`. Two concurrent finalizes could both copy; the loser's copy could overwrite the winner's final object, and a losing request returned 409 after already mutating storage. | Finalize now claims first (`claim_media_upload_ticket`, one atomic UPDATE with a random token + 120 s lease), then copies to a **claim-specific** key (`media/videos/finalized/<mediaId>/<claimToken>.<ext>`). Only the token holder can commit. A loser copies to a different key, fails `commit_media_upload_ticket`, deletes its own key, and never touches the winner. Evidence: `showcase/upload/route.ts`, `media_upload_tickets.test.sql` (one live claim, loser cannot commit, stale-lease reclaim). |
| 2 | **Concurrent staging PUT between HEAD and copy.** The staging presigned URL remains valid for 10 minutes. A client could upload bytes A, let finalize HEAD them, replace staging with bytes B of the same size/type, and have finalize copy B and commit it as if verified. | Finalize now HEADs staging (ETag, size, type), copies, then HEADs the claim-specific copy and requires the same ETag, size and content type before commit (`copiedObjectMatches`). A concurrent overwrite changes the ETag and is rejected; the claim-scoped copy is deleted. Correctness does not depend on a provider-specific conditional-copy header. Evidence: `upload-guard.ts` (`copiedObjectMatches`, `normalizeEtag`), unit tests for different/absent ETag, size and type. |
| 3 | **Lost commit response could delete a committed object.** If the commit RPC landed but its response was lost, the old error path deleted the final key, leaving a finalized ticket pointing at a missing object. | On a commit error/false, the route re-reads the ticket and resolves with the stored `final_key` (`resolveFinalizeCommit`): ours → return the committed attachment and keep the object; another claim's → delete only our claim-scoped copy and return the existing attachment; ambiguous DB error → leave the claim-scoped object for a retry instead of deleting a possibly referenced one. Evidence: `upload-guard.ts` `resolveFinalizeCommit`, route commit block, unit test. |
| 4 | **Client writable final key.** A client still holding the staging presign could overwrite the finalized object if it could reach the final key. | The canonical key includes the random claim token and is never presigned. The staging key is deleted after commit; even if the client re-creates it, it is not referenced. |
| 5 | **Crash after copy before commit.** A crash leaves a claim-specific final object with no committed ticket. | A later claimant uses a new claim token/key, so it cannot overwrite the orphan. The existing R2 orphan/reference sweep is the cleanup path; no dedicated purge was added. This is a storage-cost residual, not an integrity issue. |

**State machine:** `pending` → `claimed` (token + lease) → `finalized` / `rejected`; `release_media_upload_ticket` returns a transiently failed claim to pending. A stale claim is reclaimable after its lease; the old token can no longer commit. The final `final_key` has a uniqueness constraint, and the route returns the committed attachment for idempotent retries.

**Live verification still required:** R2 must return a stable content ETag across HEAD and CopyObject for the 50 MB single-PUT objects (the unit tests prove the comparison logic, not the provider). Staging must run the concurrent-finalize, staging-overwrite, lost-commit and reused-ticket cases before production.

### AUD-50 — revocation failure findings

| # | Defect found | Fix and evidence |
|---|---|---|
| 1 | **Enqueue-before-delete race with cron revalidation.** The first durable attempt inserted the queue row before the membership delete; the cron could see the still-existing membership, mark the row completed, and then the delete/immediate close could fail, losing the revocation. | The membership delete, moderator-grant delete and queue upsert are now one atomic SQL RPC, `remove_community_member_with_revocation`. A queue row cannot exist for a still-member, and a crash cannot leave a removed member unqueued. Evidence: migration `20261106130000`, `realtime_membership_revocations.test.sql` (atomic delete + queue, second delete false). |
| 2 | **Immediate attempt could complete a later removal's row.** The first implementation marked the queue row completed/rescheduled after the immediate close, without a generation check; a later removal could reopen the same `(user, community)` row and be marked complete by the older request. | The immediate call is now **close-only**; it does not touch the queue. The cron owns completion/backoff. Queue updates are guarded by the row's `created_at` generation, so a processor that selected an older row cannot touch a newer one. Evidence: `membership-revocation-queue.ts`, unit tests for close-only and fail→backoff→success. |
| 3 | **Realtime revocation failure after membership deletion.** If the immediate `/revoke` fails (timeout, Worker down, 5xx), the removed member's open socket could keep receiving private community events indefinitely. | The atomic RPC writes a durable row; the realtime Worker's minute cron calls a secret-authenticated internal endpoint that drains up to five due rows. Failures back off 15 s → 1 h (capped) and retry indefinitely; the processor revalidates `community_members` first so a rejoined member's new sockets are not disconnected. Evidence: `membership-revocations.ts` (Worker cron), `membership-revocation-queue.ts` (processor), `internal/membership-revocations/process` (secret), unit tests for 502/network/config and failure→recovery, integration test for room isolation. |
| 4 | **Session/other-community overreach.** A naive fix could revoke the user's whole session or all communities. | UserDO filters its `revoke-room:` registry to the target community (`chat:`, `threads:`, `events:`, `resources:`, `rules:`, `showcase:<community>:`), then closes only that user's sockets with `4003`. The user socket, DMs, session and other communities remain. Evidence: `user.ts` `revokeCommunity`, `room-routing.ts` `roomBelongsToCommunity`, integration test. |
| 5 | **Stale/duplicate requests.** A duplicate revocation or a late retry could close a rejoined member or fail a later removal. | Duplicate `/revoke` is idempotent; the queue row is unique per pair and reopened by the RPC; the processor skips still-members; `created_at` generation prevents stale completion. Evidence: SQL tests and queue tests. |

**Remaining window:** when the realtime Worker is up but `/revoke` keeps failing, the stale socket can receive events until the next cron tick (≤~1 minute) plus the retry backoff. When the realtime Worker is down, no socket receives events; reconnects are membership-checked and the queue drains after recovery. The last-member community-delete path cascades the queue row because the community and its messages are gone; the immediate close is still attempted and there is nothing left to leak.

### Socket limits and multi-device use

The limits are **per room**: 12 sockets per user and 8 per session, with oldest-socket eviction (`4008`). A miniflare test keeps three devices × two tabs each (six sockets) connected, verifies the per-user and per-session caps, verifies a replacement connection after a close, and verifies that a rejoin after a revocation is accepted. The production per-IP handshake damper is 1,200 burst / 200 per second — a flood damper sized for a shared NAT, not the authorization limit; the Room caps remain authoritative. The 50,000-socket fan-out test passes solo (31/31 integration); running two miniflare suites concurrently produced a false 21,200/50,000 delivery count, so these suites must be run serially. No product code was changed for that test-runner contention.

### Second-pass verification

- Web full suite: **1,174 / 1,174 pass**.
- Realtime integration: **31 / 31 pass** solo (50,000/50,000); socket limits: **6 / 6 integration**, **8 / 8 pure**, routing **28 / 28**; remaining non-perf suites: **239 / 239**.
- Mobile: `tsc` clean, security **18 / 18**, realtime **72 / 72**.
- Comment audit clean.
- SQL state-machine tests pass in the CI `fresh-database` job (run `42168120925`); they were not run locally because this machine has no Docker/local Supabase runtime.

**Status after second pass:** AUD-07 remains **IMPLEMENTED, LIVE VERIFICATION REQUIRED**; AUD-50 is **FIXED AND VERIFIED** (durable delivery, failure/retry tests) with a staging outage drill still recommended; AUD-49 remains **FIXED AND VERIFIED** including legitimate multi-device use.

---

## Completion summary

1. **Findings fixed:** 4 (AUD-05, AUD-06, AUD-49, AUD-50).
2. **Findings implemented, live verification required:** 3 (AUD-07, AUD-08, AUD-10).
3. **Findings still open / out of sprint:** all other audit findings listed in §3.
4. **Tests:** web 1,174/1,174; mobile security 18/18; mobile realtime 72/72; realtime socket limits 6/6 integration + 8/8 pure; revocation 6/6; integration 31/31 solo; routing/socket pure 36/36; remaining non-perf realtime 239/239; comment audit clean; two SQL state-machine suites pass in CI.
5. **Files changed:** see §4.
6. **Required operator actions:** apply both migrations; ensure Upstash is present; prebuild/rebuild the Android app; run the staging matrix in §11 (including concurrent-finalize/overwrite and realtime-outage drills); run miniflare suites serially.
7. **Migration requirements:** two forward migrations (`20261106120000_media_upload_tickets.sql`, `20261106130000_realtime_membership_revocations.sql`).
8. **Ready for staging verification:** yes, with AUD-07/08/10 explicitly marked as requiring live verification. Not deployed.
