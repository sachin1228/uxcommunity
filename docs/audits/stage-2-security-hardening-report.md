# Stage 2 — Security Hardening Implementation Report

**Date:** 2026-11-06
**Branch:** `security/stage-2-hardening`
**Base:** `main` @ `c5926c80`
**Audit:** `docs/audits/overall-repository-audit-2026-11.md` (PR #794)
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
| **AUD-07** Presigned upload size/ownership | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | Added `media_upload_tickets` (migration + types + SQL test), ticket insert on issue, finalize ownership/expiry/type/size checks, real object metadata via R2 HEAD, a one-winner claim, rejection cleanup, and a server-side copy to a client-unwritable `media/videos/finalized/...` key. Unit tests cover valid, oversized, mismatch, missing, unauthorized, reused, invalid type and expired cases. Live R2 HEAD/copy and the migration remain to be exercised on staging. |
| **AUD-08** Push after implicit sign-out | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | `createSignOutCoordinator` now detaches the push token before clearing the session cookie, bounded by the existing 2.5 s timeout; explicit logout already did this. The Android FCM service drops messages when the native signed-in user is null and drops a direct message whose `recipientId` differs; the JS foreground handler suppresses presentation/badges when signed out. Unit tests pass; real-device FCM and a rebuilt APK remain. |
| **AUD-10** Android backup | P1 in sprint | **IMPLEMENTED, LIVE VERIFICATION REQUIRED** | `android.allowBackup: false` in `app.json` plus `plugins/withAndroidBackupPolicy.js`, which also sets `fullBackupContent`/`dataExtractionRules` and writes exclusion rules for every app-data domain on prebuild. A source-of-truth test asserts both. A regenerated manifest/APK remains to be inspected on a device. |
| **AUD-49** Server-side socket limits | P1 in sprint | **FIXED AND VERIFIED** | Added per-user (default 12) and per-session (default 8) caps in the Room DO, oldest-socket eviction (close `4008`), a per-member upgrade token bucket, a production-only per-IP handshake damper, optional env overrides, and metrics (`connectionsEvictedLimit`, `upgradeRateLimited`). Pure tests + miniflare integration tests pass, including 50,000-socket fan-out. |
| **AUD-50** Membership removal socket revocation | **CRITICAL** | **FIXED AND VERIFIED** | Added a community-scoped revocation path: web helper → realtime Worker `/revoke` with `communityId` → UserDO filters its registered rooms by community → each Room DO closes that user's sockets (`4003`). Wired into self-leave, owner/admin member removal and event-chat leave. Idempotent and secret-authenticated. Integration tests prove the removed room closes while another community and the user socket stay open; duplicate revocation is safe; an unauthenticated caller gets 403. |

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
- `apps/web/app/api/communities/[id]/members/route.ts`
- `apps/web/app/api/communities/[id]/members/[userId]/route.ts`
- `apps/web/app/api/communities/[id]/events/[eventId]/rsvp/route.ts`
- `apps/web/lib/supabase/database.types.ts` (new table types; regenerate after applying the migration)

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
- `apps/realtime/__tests__/socket-limits.test.ts` (new)
- `apps/realtime/__tests__/socket-limits.integration.test.ts` (new)
- `apps/realtime/__tests__/room-routing.test.ts`
- `apps/realtime/__tests__/ws-session-revocation.test.ts` (fixture parser)
- `apps/realtime/__tests__/realtime.integration.test.ts` (status assertion: 401/403/503)

**CI / database**
- `.github/workflows/ci.yml` (mobile security tests)
- `.github/workflows/database.yml` (new SQL test)
- `package.json` (`test:mobile-security`)
- `supabase/migrations/20261106120000_media_upload_tickets.sql` (new)
- `supabase/tests/media_upload_tickets.test.sql` (new)

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
- Finalize rejects missing/wrong-owner/already-finalized/rejected/expired/mismatched/oversized/wrong-type requests.
- Real size/type comes from R2 `HEAD`, never the body.
- A conditional `finalized_at` update makes one finalize win; a client still holding the staging presign cannot replace the attachment because the canonical object is a server-side copy under `media/videos/finalized/`.
- Rejected/missing/mismatched staging objects are deleted and the ticket is marked rejected.

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
- Per-member upgrade token bucket (30 burst, 5/s) in the Room DO; production-only per-IP handshake damper (600 burst, 100/s) at the Worker.
- Counters: `connectionsEvictedLimit`, `upgradeRateLimited`, `membershipRevocations`, `socketsClosedByMembership`.

### AUD-50 — membership revocation
- Worker `/revoke` accepts a validated `communityId` and routes it to the UserDO.
- UserDO selects only `revoke-room:` entries belonging to that community (`chat:`, `threads:`, `events:`, `resources:`, `rules:`, `showcase:<community>:`), then asks each Room DO to close that user's sockets with `4003`.
- User sockets, DMs and other communities are untouched. Duplicate requests are safe. The endpoint requires the shared realtime secret; clients cannot call it.
- Wired into self-leave (including owner transfer/last-member delete), owner/admin removal, and event-chat leave.

## 6. Tests added

- `apps/web/lib/auth/rate-limit.test.ts`: strict missing-config fail-closed; availability missing-config; strict local fallback after a connection failure with limit enforcement; availability availability; development local window; failure classification.
- `apps/web/lib/auth/rate-limit-route-audit.test.ts`: sensitive prefixes stay strict; availability is allowlisted to two routes; critical routes carry a limiter.
- `apps/web/lib/security/safe-url.test.ts`: malicious schemes, credentials, control chars, malformed/overlong, bare domains, LinkedIn host rules, PATCH-body parsing.
- `apps/web/lib/video/upload-guard.test.ts`: valid finalize and every rejection reason (owner, reused, missing, oversized, size mismatch, type mismatch, expired).
- `apps/web/lib/realtime/revoke.test.ts`: community revocation body/target/auth, 502 retry, missing config.
- `apps/realtime/__tests__/socket-limits.test.ts`: caps, multi-device, reconnection, over-limit cleanup, config clamping.
- `apps/realtime/__tests__/socket-limits.integration.test.ts`: per-user cap eviction, per-session cap eviction, reconnect, membership revocation isolation, duplicate revocation, unauthenticated revocation.
- `apps/realtime/__tests__/room-routing.test.ts`: community-room mapping (including negative/suffix cases).
- `expo-app-standalone 3/lib/sessionLifecycle.test.ts`: implicit sign-out unregisters before clearing the cookie; a failed detach does not block teardown.
- `expo-app-standalone 3/lib/pushPresentation.test.ts`: signed-out/muted/already-reading suppression.
- `expo-app-standalone 3/lib/androidBackupPolicy.test.ts`: Expo config + plugin enforce backup disable and both rule files.
- `supabase/tests/media_upload_tickets.test.sql`: table, PK, unique media id, RLS, service-role-only insert.

## 7. Test execution results

| Check | Result |
|---|---|
| `apps/web: npx tsc --noEmit` | **PASS** |
| Full web unit suite (CI glob, `APP_ENV=production`) | **1164 / 1164 pass** (141 test files) |
| `apps/realtime: npx tsc --noEmit` | **PASS** |
| Realtime socket-limit + routing suite | **36 / 36 pass** |
| Realtime socket-limit integration | **13 / 13 pass** (per-user, per-session, reconnect, membership revocation, auth) |
| Realtime session-revocation suite | **6 / 6 pass** |
| Realtime integration suite | **31 / 31 pass** (including 50,000/50,000 fan-out after the IP damper was gated to production) |
| Remaining non-perf realtime suites (20 files) | **235 / 235 pass** (ownership, publish security, multi-device, presence, routing, revocation, retention, retry, dedupe, alerts, sub-entity isolation) |
| `expo-app-standalone 3: npx tsc --noEmit` | **PASS** |
| `npm run test:mobile-security` | **18 / 18 pass** |
| `npm run test:mobile-realtime` | **72 / 72 pass** |
| `node scripts/audit-comments.mjs` | **PASS** (1,590 files, 7 rules) |
| SQL test `media_upload_tickets.test.sql` | Not run locally (no Docker/local Supabase runtime in this session); added to the database workflow. |

## 8. Migrations required

One migration:

`supabase/migrations/20261106120000_media_upload_tickets.sql`

- Creates `public.media_upload_tickets` with FK cascades to `users`/`communities`, unique `media_id`/`staging_key`, expected size, expiry and finalize/reject timestamps.
- Enables RLS and restricts all access to `service_role`.
- Adds lookup indexes for user/community/expiry.

The generated Supabase types were updated by hand for this table; regenerate them from the migrated local schema before the next generation run. The deploy workflow applies pending migrations before the web Worker, which is the required sequence (see §11).

## 9. Environment variables / operator actions

- **No new required secret.** The production deploy already requires `UPSTASH_REDIS_REST_URL`/`_TOKEN`; the strict policy now treats their absence as a configuration failure instead of silently disabling limits.
- Optional realtime overrides, all with safe defaults: `ROOM_MAX_SOCKETS_PER_USER` (12), `ROOM_MAX_SOCKETS_PER_SESSION` (8), `ROOM_UPGRADE_BURST` (30), `ROOM_UPGRADE_REFILL_PER_SECOND` (5).
- Operator must run `expo prebuild --platform android --no-install` (or a normal EAS build) so the new backup plugin and native FCM gate reach the generated Android project, then produce a new APK.
- Apply the migration before deploying the web Worker; otherwise video finalize returns 500 until the table exists.
- No production credential rotation is performed by this branch (AUD-02 remains a separate operator action).

## 10. Remaining risks

- **AUD-07 live verification:** R2 `HEAD`/`CopyObject` behavior and the migration are proven only by unit tests and code here. Staging must upload a valid video, an oversized one, a mismatched one, a reused ticket and an unauthorized finalize, and confirm the staging object is deleted and the final URL is immutable.
- **Upload ticket expiry cleanup:** a ticket that is uploaded but never finalized leaves its staging object until the existing R2 orphan/reference sweep; no dedicated expiry purge was added in this sprint.
- **Rate-limit fallback is per isolate:** during a Redis outage the strict routes enforce a local budget per Worker isolate, not a global quota. The log line is actionable and missing configuration is fail-closed, but the fallback is weaker than Redis by design.
- **Rate-limit response:** a missing production configuration returns 429 ("try again"), not 503; the structured log names the configuration failure. Call sites can be refined to 503 in a follow-up.
- **AUD-08 device verification:** the native service and JS handler are unit-tested, but a real APK must prove that a push arriving after revocation is suppressed and that a legitimate multi-device push still renders.
- **AUD-10 device verification:** the config plugin/source test passes; a regenerated manifest and a clean-device backup check are still required.
- **Membership revocation scope:** `thread-comments:*` and `resource-comments:*` rooms are not mapped to a community by name. They carry only a `{user_id}` nudge, not comment content, and their sockets are not membership-gated; they are left unchanged. A removed member cannot fetch the comments through the API.
- **Realtime socket caps vs legitimate heavy tab use:** defaults are 12 per user and 8 per session; operators can raise them via the env overrides if real usage shows a need.

## 11. Deployment sequence

1. **Staging:** apply `20261106120000_media_upload_tickets.sql`; run the new SQL test; deploy the web Worker and realtime Worker.
2. **Realtime first** (or in the same release window): the new `/revoke` accepts `communityId` and the socket caps. An old web app is unaffected.
3. **Web second:** video finalize now requires a ticket row; in-flight uploads started before the deploy should be retried by the user. Membership removal now calls the new revocation path.
4. **Staging verification:** upload/finalize valid + oversized + mismatched + reused + unauthorized; remove a member from a private community and confirm their socket closes while another community and DM stay open; check `/stats` counters; verify login/chat/reset still work with Upstash healthy and with a simulated Redis outage.
5. **Mobile:** `expo prebuild` / EAS build, install on a device, verify push after implicit sign-out, multi-device push, and that the generated manifest has `allowBackup=false`.
6. **Production:** follow the approved `DEPLOY_PRODUCTION` workflow. Do not deploy production from this branch directly.

## 12. Rollback considerations

- **Web:** reverting the web Worker restores the old upload/profile/rate-limit behaviour. The `media_upload_tickets` table can remain (unused) without affecting the old code; do not drop it until all deployed clients are on the new finalize path and no ticket rows are in flight.
- **Realtime:** reverting the realtime Worker removes the socket caps and the community-revocation routing. The web helper's `communityId` request then receives 400 from the old Worker and logs a failure; membership removal falls back to the previous behaviour (socket remains until disconnect), while session revocation is unchanged. Deploy realtime and web together when rolling back.
- **Mobile:** an older APK ignores the new backup/FCM changes; the server-side push unregister still runs on explicit logout. A new APK is required for the native gate.
- **Database:** keep the migration applied. Dropping the table would break finalize on the new web code; if a full rollback is necessary, revert web first, then drop the table in a separate approved migration after confirming no references.

---

## Completion summary

1. **Findings fixed:** 4 (AUD-05, AUD-06, AUD-49, AUD-50).
2. **Findings implemented, live verification required:** 3 (AUD-07, AUD-08, AUD-10).
3. **Findings still open / out of sprint:** all other audit findings listed in §3.
4. **Tests:** web 1,164/1,164; mobile security 18/18; mobile realtime 72/72; realtime socket limits 13/13; revocation 6/6; integration 31/31; routing/socket pure 36/36; remaining non-perf realtime 235/235; comment audit clean.
5. **Files changed:** see §4.
6. **Required operator actions:** apply the migration; ensure Upstash is present; prebuild/rebuild the Android app; run the staging matrix in §11.
7. **Migration requirements:** one forward migration (`20261106120000_media_upload_tickets.sql`).
8. **Ready for staging verification:** yes, with AUD-07/08/10 explicitly marked as requiring live verification. Not deployed.
