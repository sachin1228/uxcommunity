# Supabase Egress Audit — UX Community

> **Read-only investigation.** No code was modified, no database mutation was executed
> (every statement issued was a `SELECT` or a read-only `stable` RPC), nothing was
> deployed and no production configuration was changed. The report is the only
> artifact added to the repository.
>
> **Revision:** 2026-10-15, against `main` @ `8093152f`.
>
> **How to read the confidence labels**
> - **MEASURED** — a byte count taken from the live Supabase project this workspace is
>   configured against, over real HTTP, with real rows.
> - **DERIVED** — a calculation from a MEASURED per-row size multiplied by the page
>   limit the route requests. Arithmetic, not guesswork; the row *mix* is the assumption.
> - **ESTIMATE** — depends on an assumption that the repository cannot answer (request
>   frequency, future row counts). Every such assumption is stated inline.
> - **UNKNOWN** — could not be determined from this workspace. Listed in §10.

---

## 1. Executive summary

1. **Only one of Supabase's five egress categories is actually used, and that is good
   news.** The repository contains **0** calls to `supabase.auth.*`, **0** to
   `.storage.from(`, and **0** to `.channel(`. Authentication is custom JWT (`jose` +
   `bcryptjs`), all media is Cloudflare R2, and realtime is Cloudflare Durable Objects.
   Supabase egress here is therefore **exactly one thing: bytes returned by PostgREST
   (REST + RPC responses) to the Cloudflare Worker.** Storage egress, Realtime egress and
   Auth egress are structurally $0. The Realtime *message* and *peak-connection* meters
   do not apply either. — **FACT (grep, 0 matches; `docs/infrastructure-cost-audit.md` §3)**

2. **Supabase gzips its REST responses, so billable bytes are ~14–41% of the JSON size.**
   Measured over the wire with `node:https` (no auto-decompression): `content-encoding:
   gzip` on every response. A 34,766 B home-feed page leaves Supabase as **6,465 B**;
   a 14,884 B community list as **2,951 B**. Any estimate that uses raw JSON sizes
   overstates the bill by 2.5–7×. This audit uses measured wire bytes. — **MEASURED**

   *Why the range is wide:* structured, key-heavy payloads compress to ~14–20%, while
   **long prose compresses to ~41%**. Job descriptions are prose, and that single fact
   is what makes the jobs board the top hotspot.

3. **The largest measured payload the app fetches in one request is the jobs board.**
   `get_job_feed` returns **every posting's full `description`, `responsibilities[]`,
   `requirements[]` and `skills[]`** — 81% of the row is description text. Measured
   **1,460 B on the wire per posting** → **~73 KB per 50-row board page** (mean row),
   ~88 KB at the median row, ~153 KB at the worst row. The board card renders none of
   that prose; the detail page does. — **MEASURED + DERIVED**

4. **Three queries are unbounded in a way that scales with the platform, not the user.**
   `get_all_communities` has **no `LIMIT` clause at all** and returns `description`,
   `image_url`, `lottie_url` and `lottie_format` for **every active community** (372 B
   raw/row, MEASURED) — at 5,000 communities that is **~1.8 MB of raw JSON (~368 KB on
   the wire) per Explore visit, per user**. `get_sidebar_activity` is likewise unbounded
   (one row per membership, 373 B/row). `PATCH /api/notifications {all:true}` reads
   **every unread notification row** — including `body` — merely to learn whether any
   exist and to build a realtime payload. — **MEASURED (rows) + FACT (no LIMIT in SQL/code)**

5. **The database this workspace points at is a development-scale dataset, and this is
   the single biggest caveat in the audit.** Measured live: **12 users, 55 communities,
   16 `community_messages`, 4 `job_posts`, 573 `companies`, ~1.4 k rows in total across
   every table found in the migrations.** That is nowhere near the "under 1 GB" premise.
   Either production runs on a **different Supabase project** than the one in
   `apps/web/.env.local` / `apps/web/wrangler.toml`, or the egress concern is
   forward-looking. See §10 — establishing which is true is the first action item.
   — **MEASURED (counts) + UNKNOWN (which project is production)**

6. **Current measured egress in the *only* project reachable from this workspace is
   negligible** — the dataset is too small to move 250 GB. **The audit therefore
   produces a per-request cost model, not a bill.** The model says: at 10k DAU the app
   lands near **~112 GB/month (expected scenario)**, still inside the Pro plan's 250 GB
   allowance; at 100k DAU it reaches **~1,118 GB/month, ≈ $78/month of egress overage**,
   and the high scenario reaches **~4,087 GB/month ≈ $345/month**. Egress is a *scale*
   problem here, not a *today* problem — **unless** category 5 is wrong.
   — **ESTIMATE (frequency assumptions stated in §5)**

7. **The fixable share is large and cheap.** Five changes — none of which touches the
   architecture — remove **≈ 32%** of modelled egress in the expected scenario, and the
   top two alone remove **≈ 27%** (card-only job projection + an Explore limit/cursor).
   All five are single-file or single-RPC changes. — **ESTIMATE, arithmetic in §8**

8. **The architecture is already well optimised in the places most audits find problems.**
   Bounded request cache with in-flight dedup and per-user keys
   (`lib/request-cache.ts`), 15-minute community bootstrap caching, a 10-second
   `unstable_cache` on the home-feed RPC, a 1-hour master-data cache, an R2-backed
   Next.js incremental cache, batched aggregate RPCs instead of N+1
   (`get_thread_list_aggregates`, `get_showcase_interactions`, `get_event_list_aggregates`,
   …), incremental `?after=` chat catch-up instead of re-fetching history, and
   `estimateJsonBytes` instrumentation on the seven biggest routes. **This is not an
   application that needs rewriting; it needs six specific bounds added.**

9. **Rediscovering the answer requires no migration.** Select narrowing, two `LIMIT`s, a
   card projection and one removed query cover most of the win. Neon would not fix any
   of them: the bytes leaving Postgres would be identical. See §8.13 and the final
   question 5.

10. **Blocker for cost certainty:** no Supabase dashboard metrics, no `pg_stat_statements`
    exposure, and no reachable request-count telemetry exist in this workspace (checked:
    no `pg_stat_statements`/`pg_database_size` call anywhere in `supabase/` or
    `apps/web`; the `api.timing` JSON lines go to Cloudflare Workers Logs, which this
    workspace cannot read). Every frequency figure below is therefore explicitly
    **ESTIMATE**, and §10 names the instrumentation needed to replace it with
    measurement. No request counts, response sizes or savings in this report are
    fabricated; the ones that are MEASURED are reproducible with the snippet in §12.

---

## 2. Complete Supabase usage inventory

**Scan coverage.** 710 source files under `apps/web` (`.ts`/`.tsx`/`.js`/`.mjs`, tests
excluded), plus `apps/realtime`, `packages/*`, `scripts/*`, `k6/*`, `supabase/*`.

| Measure | Value |
|---|---:|
| `createServiceClient()` import sites | 164 route handlers + 62 pages/layouts + `lib/*` |
| `.from("table")` call sites (source) | **690** |
| `.from(...).select(...)` read chains | **502** |
| …of which bounded (`limit`/`range`/`single`/head-count) | 359 |
| …of which **unbounded** | **143** |
| …of which unbounded **with no filter at all** | **7** (all small master/admin tables) |
| `callPerformanceRpc(...)` call sites | **43**, across 38 distinct RPCs |
| API route handlers under `app/api/` | **164** |
| Distinct tables addressed by name in `.from()` | 56 (more are reached only inside RPCs) |
| Tables read with `count: "exact"` | `notifications`, `community_messages` (+ admin head-counts) |
| Direct Postgres pools (`pg`, `postgres`) | **0** — everything is PostgREST over HTTPS |
| Supabase Auth / Storage / Realtime calls | **0** |

**Access model.** Every read and write goes through one module-level service-role
singleton ([service.ts](../apps/web/lib/supabase/service.ts)), which **bypasses RLS**. There
is no anon key in the app. Egress is therefore produced by the Worker only; no browser
talks to Supabase directly (verified: no `NEXT_PUBLIC_SUPABASE_ANON_KEY` anywhere).

### 2.1 Inventory by product feature

Only features that exist in the tree are listed. "Freq" = how often the call runs:
*per-request* (every invocation), *per-page-load*, *per-interaction*, *cold* (cache miss).

| Feature / module | File and line | Supabase service | Tables / resources | Request pattern | Data returned |
|---|---|---|---|---|---|
| **Auth & profiles** | | | | | |
| Dashboard shell | [layout.tsx:20-33](../apps/web/app/dashboard/layout.tsx#L20-L33) | PostgREST SELECT ×2 | `users`, `designer_profiles` | per-page-load | `name,email`; `avatar_url,city_id,sector_id,experience_level,job_title,communities_auto_joined` |
| Login | [login/route.ts:142](../apps/web/app/api/auth/login/route.ts#L142) | PostgREST SELECT | `users` | per-interaction | 1 row by email (bcrypt) |
| Session token | [lib/auth/session.ts](../apps/web/lib/auth/session.ts) | **none** | — | — | custom JWT, no Supabase Auth |
| Profile identity | [lib/profile/identity-server.ts](../apps/web/lib/profile/identity-server.ts) | RPC `update_profile_identity` | `users`, `designer_profiles`, `profile_field_changes` | per-interaction | write + audit rows |
| Resume list | [settings/resumes/route.ts:65](../apps/web/app/api/settings/resumes/route.ts#L65) | PostgREST SELECT | `member_resumes` | per-page-load | **unbounded** by user_id |
| Signup | [signup/complete/route.ts](../apps/web/app/api/signup/complete/route.ts) | RPC `complete_signup` | `users`, `designer_profiles`, `community_members` | per-interaction | ids |
| **Community directory & membership** | | | | | |
| Sidebar (3 calls) | [sidebar-server.ts:81](../apps/web/lib/communities/sidebar-server.ts#L81), [98](../apps/web/lib/communities/sidebar-server.ts#L98), [124](../apps/web/lib/communities/sidebar-server.ts#L124) | RPC `get_sidebar_activity` + SELECT ×2 | `communities`, `community_members` | per-page-load (60 s client cache) | 1 row per membership: previews, unread counts, last message, last reaction |
| Home rail (suggested) | [home-sidebar-server.ts:34](../apps/web/lib/home/home-sidebar-server.ts#L34) | RPC `get_all_communities` | `communities`, `community_members`, master tables | per-page-load (60 s server cache) | **every active community** — no LIMIT |
| Explore page | [communities/all/route.ts:20](../apps/web/app/api/communities/all/route.ts#L20) | RPC `get_all_communities` | same | per-page-load (5 min client cache) | **every active community** — no LIMIT, **not server-cached** |
| Community read model | [read-models.ts:52-150](../apps/web/lib/communities/read-models.ts#L52-L150) | PostgREST SELECT ×6+ | `community_members`, `communities`, `community_permissions`, master | per-page-load (React `cache()`) | membership + community + 10 avatars |
| Members page | [members/route.ts:53](../apps/web/app/api/communities/[id]/members/route.ts#L53) | RPC `get_community_members_page` | `community_members`, `users` | per-page-load, `limit 30` | bounded |
| Join / request | [join/route.ts](../apps/web/app/api/communities/[id]/join/route.ts), [requests/route.ts:35-54](../apps/web/app/api/communities/[id]/requests/route.ts#L35-L54) | PostgREST SELECT/INSERT | `community_join_requests`, `community_members` | per-interaction | small; requests list **unbounded** |
| **Community chat & message history** | | | | | |
| Chat page (bootstrap) | [bootstrap/route.ts:69-96](../apps/web/app/api/communities/[id]/bootstrap/route.ts#L69-L96) | RPC + SELECT ×4 sections | 5 sections: read model, message page, content events, rules | per-page-load | 50 messages + nested users/reactions/replies |
| Message page | [read-models.ts:451](../apps/web/lib/communities/read-models.ts#L451) | RPC `get_community_message_page` | `community_messages`, `users`, `message_reactions` | per-page-load, `p_limit 50` | 50 rows, each with `users`, `reactions`, `reply_to`, `reply_to_content`, `mentions` |
| Content-id lookup | [messages/route.ts:21-24](../apps/web/app/api/communities/[id]/messages/route.ts#L21-L24) | PostgREST SELECT ×4 | `community_threads`, `community_showcase_posts`, `community_resources`, `community_events` | per chat fetch when `withContentReactions=1` | 4 × `limit 50` of **ids only** (cached 60 s, [content-event-ids.ts](../apps/web/lib/communities/content-event-ids.ts)) |
| Incremental catch-up | [useChatData.ts](../apps/web/components/communities/chat/useChatData.ts) + [useRealtimeChat.ts:62](../apps/web/components/communities/chat/useRealtimeChat.ts#L62) | RPC (same) with `p_after` | same | per focus / reconnect / room switch | only messages newer than the client cursor |
| Send message | [communities/[id]/messages/route.ts:100+](../apps/web/app/api/communities/[id]/messages/route.ts) | SELECT + INSERT | `community_members`, `community_messages`, `users` | per-interaction | ~0 returned (write) |
| Retention cron | [community-message-retention/route.ts:47](../apps/web/app/api/internal/community-message-retention/route.ts#L47) | PostgREST DELETE | `community_messages` | scheduled, `limit` | 0 response |
| **Realtime (events & presence)** | | | | | |
| Web + mobile realtime | [lib/realtime/client.ts](../apps/web/lib/realtime/client.ts) | **none (Supabase)** | Cloudflare Durable Objects | WSS | **0 Supabase egress** |
| Notifications stream | [use-notifications.ts:176+](../apps/web/lib/use-notifications.ts#L176) | **none (Supabase)** | `UserDO` | WSS | 0 |
| DM stream | [useDmRealtime.ts](../apps/web/components/direct-messages/hooks/useDmRealtime.ts) | **none (Supabase)** | `UserDO` | WSS | 0 |
| **Direct messages** | | | | | |
| Conversation list | [direct-messages/server.ts:88](../apps/web/lib/direct-messages/server.ts#L88) | RPC `get_dm_conversations` | `dm_conversations`, `dm_messages`, `dm_message_reactions` | per-page-load | 1 row per conversation, no LIMIT |
| DM message page | [direct-messages/server.ts:308](../apps/web/lib/direct-messages/server.ts#L308) | RPC `get_dm_message_page` | `dm_messages` | per-page-load, `p_limit 50` | bounded |
| Unread badge | [useDmUnreadBadge.ts:49-93](../apps/web/components/direct-messages/hooks/useDmUnreadBadge.ts#L49-L93) | RPC `get_dm_unread_total` | `dm_conversations`, `dm_messages` | mount + **every peer DM realtime event (600 ms debounce)** + hidden catch-up | a **single integer** (1 B) |
| **Posts, comments, reactions, feeds** | | | | | |
| Home feed | [home/feed/route.ts:26-99](../apps/web/app/api/home/feed/route.ts#L26-L99) | RPC `get_home_feed_page` + RPC ×2 | 5 content tables + interactions | per-page-load (10 s server cache) | 30 feed cards (MEASURED 34,766 B raw / 6,465 B wire) |
| Threads list | [read-models.ts:247](../apps/web/lib/communities/read-models.ts#L247) | RPC `get_thread_list_page` | `community_threads` | per-tab-load, `p_limit 51` | 50 rows incl. `tags, attachments, links, poll` |
| Resources list | [read-models.ts:285](../apps/web/lib/communities/read-models.ts#L285) | RPC `get_resource_list_page` | `community_resources` | per-tab-load, `p_limit 101` | **100 rows** |
| Showcase list | [read-models.ts:324](../apps/web/lib/communities/read-models.ts#L324) | RPC `get_showcase_list_page` | `community_showcase_posts` | per-tab-load, `p_limit 26` | 25 rows |
| Events list | [read-models.ts:351](../apps/web/lib/communities/read-models.ts#L351) | RPC `get_event_list_page` | `community_events` | per-tab-load, `p_limit 26` | 25 rows (upcoming, then past) |
| Comments (4 kinds) | [threads …/comments/route.ts:54](../apps/web/app/api/communities/[id]/threads/[threadId]/comments/route.ts#L54) and the resource/showcase/event equivalents | PostgREST SELECT ×3 | `thread_comments` + `users` + reactions | per-detail-open, **unbounded** | **every comment on the item**, then authors, then all reaction rows |
| Fine-grained reactions | [comment-reactions.ts:57](../apps/web/lib/communities/comment-reactions.ts#L57) | PostgREST SELECT | `content_reactions`/`thread_comment_reactions` | per reaction toggle **and** per comment-list load | every `(user_id, emoji)` row for the ids — **unbounded** |
| Message reactions | [messages/[msgId]/reactions/route.ts:142](../apps/web/app/api/communities/[id]/messages/[msgId]/reactions/route.ts#L142) | PostgREST SELECT | `message_reactions` | per toggle | every reactor row — **unbounded** |
| Likes/saves/RSVPs | `threads/[threadId]/like`, `event/[eventId]/like`, `save`, `rsvp` routes | PostgREST SELECT/INSERT | `thread_likes`, `event_likes`, `event_saves`, `event_rsvps` | per-interaction | 0–1 rows |
| Profile / member feed | [profile/feed/route.ts:100-106](../apps/web/app/api/profile/feed/route.ts#L100-L106) | RPC `get_profile_feed_page` / `get_member_feed_page` | 5 content tables | per-page-load, 30 items | 30 cards (MEASURED 12,011 B raw) |
| **Search & discovery** | | | | | |
| Company search | [companies/search/route.ts](../apps/web/app/api/companies/search/route.ts) | RPC `search_companies` | `companies`, `company_domains` | per keystroke-batch, `limit 8` | 8 rows (MEASURED 1,539 B raw / 494 B wire) |
| Master data | [data/cities](../apps/web/app/api/data/cities/route.ts) etc., [master-data-cache.ts:31-102](../apps/web/lib/master-data-cache.ts#L31-L102) | PostgREST SELECT (whole table) | `cities`, `design_sectors`, `experience_levels`, `job_titles` | **cold** (1 h `unstable_cache`, R2-backed) | whole table × 3 maps (image/name/lottie) |
| **Notifications** | | | | | |
| List + unread count | [notifications/route.ts:19-38](../apps/web/app/api/notifications/route.ts#L19-L38) | PostgREST SELECT + head-count | `notifications` | per-page-load (30 s client cache) | 30 rows + exact count |
| Mark one read | [notifications/route.ts:124+](../apps/web/app/api/notifications/route.ts#L124) | SELECT + UPDATE | `notifications` | per-interaction | 1 row |
| **Mark all read** | [notifications/route.ts:67-70](../apps/web/app/api/notifications/route.ts#L67-L70) | PostgREST SELECT **unbounded** | `notifications` | per-interaction | **every unread row incl. `body`** |
| **Events & jobs** | | | | | |
| Job board (SSR) | [jobs/page.tsx](../apps/web/app/dashboard/jobs/page.tsx) → [jobs/service.ts:217](../apps/web/lib/jobs/service.ts#L217) | RPC `get_job_feed` | `job_posts` + company + poster | per-page-load, `p_limit 50` | **full description + responsibilities + requirements + skills per posting** |
| Job board (pager) | [jobs/feed/route.ts:39](../apps/web/app/api/jobs/feed/route.ts#L39) | RPC `get_job_feed` (`limit + 1`) | same | per-sentinel, `limit 51` | same full payload |
| Job detail | [jobs/service.ts](../apps/web/lib/jobs/service.ts) `getJobDetail` | RPC `get_job_detail` | same | per-page-load | 1 posting |
| Applicants | `get_job_applicants` + [loadJobApplicantDetails](../apps/web/lib/jobs/service.ts) | RPC + SELECT | `job_applications`, `designer_profiles`, `cities` | per-page-load | bounded by applicant count |
| City events | [events/service.ts:92](../apps/web/lib/events/service.ts#L92) | RPC `get_city_event_list_page` | `community_events` | per-page-load, `p_limit 25` | bounded |
| **Media & uploads** | | | | | |
| Uploads | [lib/r2.ts](../apps/web/lib/r2.ts) | **none (Supabase)** | Cloudflare R2 | PUT/presign | **0 Supabase egress** |
| Link preview | [link-preview/route.ts](../apps/web/app/api/link-preview/route.ts) | none | external fetch | per-interaction | 0 |
| **Admin & moderation** | | | | | |
| Companies admin | [admin/companies/route.ts:52](../apps/web/app/api/admin/companies/route.ts#L52) | RPC `admin_list_companies` | `companies`, `company_domains` | per-page-load | **100 rows, `select *`** (MEASURED 45,238 B raw / 5,098 B wire) |
| Community admin | [admin/communities/route.ts:17-45](../apps/web/app/api/admin/communities/route.ts#L17-L45) | SELECT + head-count | `communities`, `community_messages` | per-page-load | **all communities, no LIMIT** |
| Messages moderation | [admin/communities/messages/route.ts](../apps/web/app/api/admin/communities/messages/route.ts) | SELECT | `community_messages` | per-page-load | unbounded |
| Reports | [admin/reports/[contentType]/[contentId]/route.ts](../apps/web/app/api/admin/reports/[contentType]/[contentId]/route.ts) | SELECT ×4 incl. `select("*")` | `content_reports`, `content_removals` | per-page-load | wide |
| Master-data admin | `admin/cities`, `admin/sectors`, `admin/experience-levels`, `admin/job-titles`, `admin/lottie-settings` | SELECT | 5 master tables | per-page-load | whole table, `limit 500` |
| Signup attempts | [admin/signup-attempts](../apps/web/app/api/admin/signup-attempts/route.ts) | SELECT | `signup_attempts` | per-page-load | 25/page |
| **Company directory** | | | | | |
| Company page | [companies/service.ts](../apps/web/lib/companies/service.ts) | RPC `get_company_page` | `companies`, `company_domains`, `company_members` | per-page-load | `domains` + `members` as JSON |
| Membership | `companies/membership`, `get_user_company`, `company_domain_owner` | RPC | company tables | per-interaction | small |
| Verification | `start_company_verification`, `confirm_company_verification` | RPC | `company_email_verifications` | per-interaction | small |
| **Other** | | | | | |
| Health check | [healthz/route.ts](../apps/web/app/api/healthz/route.ts), [health/dependencies.ts](../apps/web/lib/health/dependencies.ts) | PostgREST probe | — | **every 5 min (cron)** | ~0 |
| Push | [lib/push/chat.ts:494](../apps/web/lib/push/chat.ts#L494) | SELECT (chunked 500) | `community_members`, `push_tokens` | per message send (deferred) | member/token ids |
| Realtime publish | [lib/communities/message-publish.ts](../apps/web/lib/communities/message-publish.ts) | **none (Supabase)** | Cloudflare DO | per message | 0 |

### 2.2 Categories that do **not** exist (verified absent, so they cannot be a source)

`supabase.auth.*` (0) · `.storage.from(` (0) · `.channel(` (0) · `pg`/`postgres` pool (0) ·
Edge Functions (0) · `pg_stat_statements` (0 references) · Supabase Log Drains (0).

---

## 3. Architecture and data-flow overview

```
Browser / Expo
   │  HTTPS (no anon key; never talks to Supabase)
   ▼
Cloudflare Worker (Next.js via OpenNext)  ── 164 route handlers, 62 pages
   │
   │  HTTPS + service-role key, gzip, PostgREST/Kong (NOT Supavisor)
   ▼
Supabase Postgres   ◄── THE ONLY METERED BYTE PATH
   │
   │  WSS (Cloudflare Durable Objects: Room / UserDO) — $0 Supabase
Cloudflare DO  ──►  Room broadcast, UserDO notifications
   │
R2 (media, free egress) · CDN (free) · Expo Push · Resend · Upstash · GIPHY
```

**Where egress is metered and where it is not:**

| Path | Counts as Supabase egress? | Evidence |
|---|---|---|
| Worker → Supabase PostgREST/RPC **response** | **Yes — this is the whole bill** | `service.ts` is the only client; every query is server-side |
| Browser → Worker response (HTML/JSON/JS) | No | served by Cloudflare; Workers/CDN egress is free |
| R2/`R2_PUBLIC_URL` media | No | R2 egress is free in every storage class |
| Durable Object fan-out | No | outgoing WS messages are not billed and Supabase is not involved |
| Supabase Auth / Storage / Realtime | N/A | not used |
| Postgres disk reads / query processing | **No** | egress is network transfer, not database I/O |
| Insert/update **request** payloads | No | only response bytes are egress |
| **Supavisor / Shared Pooler Egress** | **No** | the repo has no direct Postgres client; all traffic is PostgREST over HTTPS, not the pooler |

**Per-request shape of a dashboard load** (SSR + client, after caching):

| # | Call | Trigger | Server query | Measured wire bytes |
|---|---|---|---:|---:|
| 1 | `GET /dashboard` RSC (layout) | navigation | 2 SELECT | ~250 |
| 2 | `GET /api/communities` | `GlobalSidebar` | RPC + 2 SELECT | 7,083 |
| 3 | `GET /api/notifications` | `NotificationBell` | SELECT + head-count | ~3,885 (14 rows) |
| 4 | `GET /api/home/feed` | `HomeFeed` | RPC + RPC ×2 | **6,465** |
| 5 | home rail | RSC | RPC `get_all_communities` (60 s cache) | ~2,951 |
| 6 | WSS `notifications:${userId}`, `chat:${cid}` × ≤15 | realtime | **0 Supabase** | 0 |

**Per community open:** `bootstrap` (read model + 50-message page + content-events +
rules) — one HTTP request, 4 DB sections; then incremental `?after=` catch-up only.

**Interaction with the realtime layer.** Cloudflare rooms do not replay missed events, so
the client reconciles by **refetching**, not by Supabase change feeds:

- `useHiddenCatchUp` ([use-hidden-catchup.ts:12](../apps/web/lib/use-hidden-catchup.ts#L12)) — fires only after the tab was hidden **≥ 5 s**, collapsing alt-tab storms into nothing.- Chat catch-up ([useRealtimeChat.ts:62](../apps/web/components/communities/chat/useRealtimeChat.ts#L62)) — 300 ms debounce, bounded to `MAX_CATCH_UP_PAGES = 20` × `MAX_CATCH_UP_PASSES_PER_DRAIN = 4`, 2 retries, and **incremental (`p_after`)** so it never re-reads history  ([useChatData.ts:38-46](../apps/web/components/communities/chat/useChatData.ts#L38-L46)).
- Sidebar polls (`setInterval`, [useSidebarCommunities.ts:163](../apps/web/components/communities/panel/useSidebarCommunities.ts#L163)) **only** when memberships exceed `SIDEBAR_REALTIME_LIMIT = 15`, on the 60 s stale window.
- DM badge refetches on every peer DM realtime event ([useDmUnreadBadge.ts:83-93](../apps/web/components/direct-messages/hooks/useDmUnreadBadge.ts#L83-L93)) — a **realtime event that triggers a follow-up fetch**, but the response is one integer, so it is a request-count cost, not an egress cost.

**Categories, explicitly separated (§3 of the brief):**

| # | Category | Present here? | Monthly volume |
|---|---|---|---|
| A | Database / PostgREST response traffic | **Yes — the only one** | see §5 |
| B | Database query processing / internal reads | Yes, runs, but **not egress** | n/a (compute/IOPS, not billed as egress) |
| C | Retired realtime publication traffic | **No** | 0 |
| D | Supabase Storage upload/download | **No** | 0 |
| E | Cloudflare Cache / R2 | Yes | **free** |
| F | Other network (Resend, Upstash, Expo, GIPHY) | Yes | not Supabase egress |

Per the current pricing documentation, **A is the only one that maps to the Supabase
"Egress"/"Uncached Egress" billing item**, and it is metered on actual transmitted bytes
(§7).

---

## 4. Top 10 egress hotspots, ranked

Ranking = measured bytes per call × modelled calls per DAU (expected scenario, §5).
"Impact" states *why* the bytes are unnecessary, not merely that the query looks odd.

### 4.0 Summary table

Basis for the GB column: **expected session mix at 10k DAU → 111.8 GB/month total** (§5),
the scenario whose per-call bytes are all MEASURED and whose only assumption is view
frequency. Confidence is per row: **bytes are measured; frequency is assumed**, hence
"medium" throughout, with the cause named. "Potential reduction" is the share of *that*
line the smallest safe fix removes, and the parenthetical is its share of the total.

| Rank | Feature / API | Main cause | Estimated GB/month (10K DAU) | Confidence | Potential reduction |
|---:|---|---|---:|---|---|
| 1 | Jobs board — `get_job_feed` ([service.ts:217](../apps/web/lib/jobs/service.ts#L217)) | Response size + worst compression (40.6%): full `description` + 3 arrays per posting, none of it rendered on a card | 21.9 | Medium (bytes measured, frequency assumed) | ~85% of this line (≈18% of total) — card-only projection |
| 2 | Community bootstrap ([bootstrap/route.ts:69](../apps/web/app/api/communities/[id]/bootstrap/route.ts#L69)) | 4 sections bundled, incl. the 50-message page, on every cold open | 19.0 | Medium | ~40% (≈6.5% of total) — `?section=` variant so a non-chat tab skips chat |
| 3 | Content lists — threads/resources/showcase/events ([read-models.ts:247](../apps/web/lib/communities/read-models.ts#L247)) | Page size × wide projection: 100 resources, 50 threads with `attachments`/`links`/`poll` | 18.2 | Medium | ~40% (≈6.5% of total) — 100→30, list projections trimmed |
| 4 | Notifications ([route.ts:21](../apps/web/app/api/notifications/route.ts#L21), [:67](../apps/web/app/api/notifications/route.ts#L67)) | `metadata`+`body` in every list row; mark-all-read re-reads **every unread row** to decide whether to update | 12.4 | Medium | ~40% (≈5% of total) — unconditional UPDATE, select `id` only |
| 5 | Explore — `get_all_communities` ([all/route.ts:20](../apps/web/app/api/communities/all/route.ts#L20)) | **No `LIMIT` in the SQL**; returns every active community with 4 display fields, uncached | 11.1 | Medium | → ~60% now, and converts platform-linear growth to constant (≈5% of total) |
| 6 | Sidebar — 3 calls ([sidebar-server.ts:81](../apps/web/lib/communities/sidebar-server.ts#L81)) | `get_sidebar_activity` unbounded: one row per membership with previews; plus 2 more queries | 8.5 | Medium | ~20% (≈1.5% of total) — fold mute state into the RPC |
| 7 | Home feed ([home/feed/route.ts:26](../apps/web/app/api/home/feed/route.ts#L26)) | 30 full feed cards, per user; already deduped 10 s server-side | 7.8 | Medium | ~20% (≈1.5% of total) — narrower card projection |
| 8 | Community chat page ([read-models.ts:451](../apps/web/lib/communities/read-models.ts#L451)) | 50 rows, each with embedded `users` (26% of the page), `reactions`, reply previews | 7.4 | Medium | ~25% (≈1.5% of total) — drop the per-row author blob |
| 9 | Profile activity feed ([profile/feed/route.ts:100](../apps/web/app/api/profile/feed/route.ts#L100)) | 30 cards with per-viewer flags; 25.7% gzip ratio | 2.8 | Medium | ~30% (≈0.8% of total) — narrower cards |
| 10 | Direct messages ([server.ts:88](../apps/web/lib/direct-messages/server.ts#L88)) | Conversation list + badge refetch per realtime event (1-byte response — a request-count cost, not egress) | 2.6 | Medium | ~10% (≈0.2% of total) — batch badge updates |

**Unranked but structurally important:** unbounded comment and reaction reads
(§4 #7) sit *inside* lines 2, 3 and 8 and cost little at today's row counts, but they are
the only paths where a single request can return a multi-MB response. The unbounded
mark-all-read (§4 #5) is the same class.

### 1. Jobs board — `get_job_feed` ships every posting's prose
- **Cause:** response size **and** poor compression. `get_job_feed` returns `description`, `responsibilities[]`, `requirements[]`, `skills[]` for all 50 rows.
- **Files:** [jobs/service.ts:202-217](../apps/web/lib/jobs/service.ts#L202-L217), [jobs/feed/route.ts:39](../apps/web/app/api/jobs/feed/route.ts#L39), [jobs/types.ts:96](../apps/web/lib/jobs/types.ts#L96), SSR consumer [jobs/page.tsx](../apps/web/app/dashboard/jobs/page.tsx).
- **Frequency:** every boards page-view + every auto-load sentinel page.
- **Rows / size:** 50 rows. **MEASURED** 1,460 B *on the wire* per row (5,842 B for 4 rows) → **~73 KB per page**, ~88 KB at the median row, ~153 KB worst-case. Description text is **81%** of the raw row (9,518 of 11,730 B).
- **Repeated/duplicated?** Yes, twice over: the SSR page and the pager endpoint both call the same RPC, and the pager deliberately over-fetches one row (`limit + 1`) to compute `has_more`.
- **Evidence:** §6 measurements; gzip ratio 40.6% (measured) — the worst in the app.
- **Impact: HIGH.** ~20% of modelled egress from one endpoint.
- **Fix:** select a **card projection** (no `description`/lists) for the feed RPC and load the full posting only in `get_job_detail`.

### 2. `get_all_communities` — unbounded, platform-wide read
- **Cause:** the SQL has **no `LIMIT`** and returns 4 display fields per community.
- **Files:** [communities/all/route.ts:20](../apps/web/app/api/communities/all/route.ts#L20) (uncached), [home-sidebar-server.ts:34](../apps/web/lib/home/home-sidebar-server.ts#L34) (60 s cache), migration [20261012140000_explore_pending_join_request.sql](../supabase/migrations/20261012140000_explore_pending_join_request.sql).
- **Frequency:** Explore visit + home rail (cached 60 s per user).
- **Rows / size:** **MEASURED 372 B raw / 73.8 B wire per community.** 15 kB raw at 40 communities → **projected ~1.85 MB raw (~368 KB wire) at 5,000 communities, per request, per user.**
- **Impact: HIGH (grows with the platform, not the user).** 9.9% of modelled egress *today at 40 rows*; it is the only hotspot whose cost grows with total content rather than with usage.
- **Fix:** `LIMIT` + keyset cursor in the RPC (joined/joined-state only needs a page), and `unstable_cache` on the Explore route as the rail already has.

### 3. Community bootstrap — 4 sections in one request
- **Cause:** architecturally deliberate bundling (read model + 50-message page + content-events + rules), so the client makes one round trip. The message page dominates.
- **Files:** [bootstrap/route.ts:69-96](../apps/web/app/api/communities/[id]/bootstrap/route.ts#L69-L96), [read-models.ts:451](../apps/web/lib/communities/read-models.ts#L451).
- **Rows / size:** **DERIVED ~10.5 KB wire** on a cache miss (read model 444 B + avatars 316 B + 50-message page ~3.9 KB + rules ~5.9 KB). Free on a revisit inside `COMMUNITY_BOOTSTRAP_STALE_MS = 15 min`.
- **Impact: HIGH at expectation, and correctly mitigated** — 15-min client caching plus React `cache()` means this is paid roughly once per community per 15 min, not per render.
- **Fix:** see #7 (chat projection); consider a `?section=` variant so a tab switch does not need the message page.

### 4. Chat message page — 50 rows with three embedded JSON blobs each
- **Cause:** each row carries `users` (author), `reactions`, `reply_to`, `reply_to_content`, `mentions`, `content_reactions`.
- **Files:** [read-models.ts:451](../apps/web/lib/communities/read-models.ts#L451), [performance-rpcs.ts:7-31](../apps/web/lib/supabase/performance-rpcs.ts#L7-L31).
- **Rows / size:** **MEASURED 549 B raw/row; 78 B wire/row** → 50-row page ≈ 27.5 kB raw / **3.9 kB wire**. **The embedded `users` object alone is 1,839 B — 26% of the page.**
- **Frequency:** once per community open (cache miss) + incremental `p_after` drains (small, bounded).
- **Impact: MEDIUM.** The page is already paginated and incrementally caught up, which is the right shape; the waste is the redundant author blob the client already has from `members`.
- **Also confirmed NOT a problem:** the app does **not** re-fetch 50-message history on reconnect. Catch-up is `?after=`-cursor based and bounded.

### 5. Notifications list + the unbounded mark-all-read
- **Cause (two parts):** (a) the 30-row list carries `metadata` jsonb + `body` (**26%** of the raw page); (b) `PATCH {all:true}` reads **every unread row incl. `body`** just to decide whether to run the `UPDATE` and to build a realtime payload.
- **Files:** [notifications/route.ts:21-32](../apps/web/app/api/notifications/route.ts#L21-L32), [notifications/route.ts:67-70](../apps/web/app/api/notifications/route.ts#L67-L70).
- **Rows / size:** list **MEASURED 277 B wire/row** → 8.3 kB per 30-row page. Mark-all-read: **MEASURED 585 B raw/row** → 5,000 unread rows ≈ 2.9 MB raw / ~1.0 MB wire **per click**.
- **Impact: MEDIUM today, HIGH for the heaviest users.** The list is bounded; the mark-all-read is not, and it is the single largest *unbounded-per-user* read in the app.
- **Fix:** run the `UPDATE` unconditionally and select only `id` for the realtime payload (or skip the pre-read entirely).

### 6. Community content lists (threads / resources / showcase / events)
- **Cause:** generous page sizes — **100 resources**, 50 threads, 25 showcase, 25 events — with wide projections (`tags, attachments, links, poll` on threads).
- **Files:** [read-models.ts:247](../apps/web/lib/communities/read-models.ts#L247), [:285](../apps/web/lib/communities/read-models.ts#L285), [:324](../apps/web/lib/communities/read-models.ts#L324), [:351](../apps/web/lib/communities/read-models.ts#L351); client constants [ResourcesView.tsx:41](../apps/web/components/communities/resources/ResourcesView.tsx#L41) (`RESOURCE_PAGE_SIZE = 100`), [ThreadsView.tsx:33](../apps/web/components/communities/threads/ThreadsView.tsx#L33).
- **Rows / size:** **MEASURED** per-row: threads 588 B, resources 427 B, showcase 726 B, events 433 B raw → **DERIVED ~20 KB raw / ~4.6 KB wire per tab load** (resources alone 42.7 kB raw → 8.5 kB wire).
- **Impact: MEDIUM–HIGH.** 16.3% of modelled egress. Aggregate RPCs already prevent N+1 here; the remaining cost is simply *page size × columns*.
- **Fix:** 100 → 30 for resources; drop `attachments`/`links`/`poll` from the list projection (needed only on detail).

### 7. Comments and reactions — the app's unbounded reads
- **Cause:** every comment on an item, then every reaction row for those comments, with no cap. Reaction rows are `(user_id, emoji)` per person.
- **Files:** [threads …/comments/route.ts:54](../apps/web/app/api/communities/[id]/threads/[threadId]/comments/route.ts#L54) (+ resource/showcase/event equivalents), [comment-reactions.ts:57-58](../apps/web/lib/communities/comment-reactions.ts#L57-L58), [messages/[msgId]/reactions/route.ts:142](../apps/web/app/api/communities/[id]/messages/[msgId]/reactions/route.ts#L142), [content-events.ts:148](../apps/web/lib/communities/content-events.ts#L148).
- **Rows / size:** **MEASURED 304 B raw per comment row** (dev data has short bodies; 5,000-char bodies are allowed, so real rows can be ~10× larger). Reactions are ~66 B/row.
- **Impact: MEDIUM today, HIGH on a viral thread.** A 2,000-comment thread with 10k reactions is ~1 MB raw per open, and it is re-read on **every** comment-list load and every reaction toggle.
- **Fix:** cursor-paginate with a count aggregate; for reactions return grouped counts (`emoji → count`) plus only the caller's own rows, replacing a per-user row dump.

### 8. Sidebar — three calls, one row per membership
- **Cause:** `get_sidebar_activity` is unbounded (one row per membership, each with last-message + last-reaction previews), plus a communities projection and a mute query.
- **Files:** [sidebar-server.ts:81](../apps/web/lib/communities/sidebar-server.ts#L81), [:98](../apps/web/lib/communities/sidebar-server.ts#L98), [:124](../apps/web/lib/communities/sidebar-server.ts#L124).
- **Rows / size:** **MEASURED 373 B raw / 68 B wire per membership**; the three calls total **7,083 B wire for 44 memberships**. At 200 memberships: ~74.6 kB raw → **~18 kB wire per sidebar load**.
- **Frequency:** every dashboard load, 60 s client cache; polled every 60 s only past 15 memberships.
- **Impact: MEDIUM.** Scales with the power user, not the platform. **Note:** the older "sidebar transfers unbounded historical rows" finding in `docs/performance-audit.md` is **fixed** — a 2026-09 change moved aggregation into `get_sidebar_activity`.

### 9. Reaction-toggle round trips that re-read grouped state
- **Cause:** after every toggle the route re-reads the full grouped reaction set for the item to return authoritative state.
- **Files:** [threads …/reactions/route.ts:70-75](../apps/web/app/api/communities/[id]/threads/[threadId]/comments/[commentId]/reactions/route.ts#L70-L75), [comment-reactions.ts:45](../apps/web/lib/communities/comment-reactions.ts#L45).
- **Rows / size:** proportional to the item's reaction rows (unbounded, see #7) — small on the dev dataset (265 B for all `content_reactions`).
- **Impact: LOW–MEDIUM**, but it couples egress to interaction rate and re-reads the same set the client could patch locally.

### 10. Admin surfaces — `select *`, 100-row pages, uncapped lists
- **Cause:** wide projections and no `LIMIT` on several admin reads.
- **Files:** [admin/companies/route.ts:52](../apps/web/app/api/admin/companies/route.ts#L52) (100 rows, `select *` → **MEASURED 45,238 B raw / 5,098 B wire**), [admin/communities/route.ts:17](../apps/web/app/api/admin/communities/route.ts#L17) (all communities, no LIMIT), [admin/communities/messages/route.ts](../apps/web/app/api/admin/communities/messages/route.ts), [admin/reports/…/route.ts:251-258](../apps/web/app/api/admin/reports/[contentType]/[contentId]/route.ts#L251-L258) (`select("*")`), `admin/master-data/fetch-images` (`limit 500`), the five master-data admin routes.
- **Impact: LOW** in traffic terms (admin-only), **MEDIUM** in absolute per-request size, and it is where the repo's 12 `select("*")` calls live ([analyzer output §12](#12-reproducing-the-measurements)).
- **Fix:** replace `select *` with explicit columns; add `limit`/cursors.

**Also noted (not in the top 10, tracked for completeness):** master-data whole-table reads on cold cache ([master-data-cache.ts:31-102](../apps/web/lib/master-data-cache.ts#L31-L102)) — tiny now (41 cities), unbounded in principle; `get_sidebar_activity` + `get_all_communities` double work on the dashboard (the rail and the sidebar both read them); and the four `limit(50)` id-only lookups per chat fetch, which are already 60 s cached.

---

## 5. Feature-by-feature estimated monthly egress

**Method.** `monthly GB = Σ (measured wire bytes per call × calls per DAU-day) × 30 / 1e9`.
Per-call wire bytes are MEASURED (§6). **Calls per DAU-day is an ASSUMPTION** — no
request-count telemetry is reachable from this workspace (§10). Three mixes are given so
the reader can pick the plausible one and sanity-check against the Supabase dashboard.

| Assumption | low | expected | high |
|---|---:|---:|---:|
| Dashboard visits / DAU-day | 1 | 4 | 10 |
| Community opens / DAU-day | 2 | 6 | 20 |
| Chat triggers (page or catch-up) / DAU-day | 1 | 5 | 25 |
| Content-tab loads / DAU-day | 0.5 | 3 | 10 |
| Explore visits / DAU-day | 0.05 | 0.5 | 3 |
| Job-board views / DAU-day | 0.02 | 1 | 4 |
| Profile-feed views / DAU-day | 0.1 | 1 | 4 |
| DM activity / DAU-day | 0.2 | 1 | 4 |

### Expected scenario — 364 KiB per DAU-day

| Feature | B / DAU-day | Share | 1K DAU | 10K DAU | 100K DAU |
|---|---:|---:|---:|---:|---:|
| Jobs board (`get_job_feed` + SSR) | 73,025 | **19.6%** | 2.19 | 21.9 | **219** |
| Community bootstrap | 63,240 | 17.0% | 1.90 | 19.0 | 190 |
| Community content lists (4 tabs) | 60,645 | 16.3% | 1.82 | 18.2 | 182 |
| Notifications (list + mark-read) | 41,300 | 11.1% | 1.24 | 12.4 | 124 |
| Explore (`get_all_communities`) | 36,851 | 9.9% | 1.11 | 11.1 | 111 |
| Sidebar (3 calls) | 28,332 | 7.6% | 0.85 | 8.5 | 85 |
| Home feed | 25,860 | 6.9% | 0.78 | 7.8 | 78 |
| Community chat (page + catch-up) | 24,595 | 6.6% | 0.74 | 7.4 | 74 |
| Profile activity feed | 9,261 | 2.5% | 0.28 | 2.8 | 28 |
| Direct messages | 8,698 | 2.3% | 0.26 | 2.6 | 26 |
| Dashboard layout SSR | 1,000 | 0.3% | 0.03 | 0.3 | 3 |
| **TOTAL** | **372,807** | 100% | **11.2 GB/mo** | **111.8 GB/mo** | **1,118 GB/mo** |

### Low / high scenarios

| Scenario | KiB/DAU-day | 1K DAU | 10K DAU | 100K DAU | Confidence |
|---|---:|---:|---:|---:|---|
| Low (light users) | 66 | 2.0 GB/mo | 20.4 | 204 | low |
| **Expected** | **364** | **11.2 GB/mo** | **111.8** | **1,118** | **medium** |
| High (heavy multi-community users) | 1,330 | 40.9 GB/mo | 408.7 | 4,087 | low |

*Reading the table:* the **expected** cell for 10K DAU (111.8 GB) is the number to check
first against the Supabase dashboard. If the dashboard shows materially more, the
frequency assumptions are too low (or hotspot-unbounded reads are being hit harder);
if it shows far less, either usage is below the low mix or category 5 in §1 is in play.

**Per-request confidence:** every byte figure feeding this table is either MEASURED
(full page) or DERIVED from a MEASURED per-row size. The **only** low-confidence input is
**calls per DAU-day**, which is an assumption, and it is the sole reason the totals carry
a 20× spread between low and high.

---

## 6. Measured metrics versus estimates

### 6.1 What was actually measured

Live reads against the project named by `apps/web/.env.local` (same host as
`apps/web/wrangler.toml` → the project the deployed Worker uses). Row counts via
read-only `HEAD` counts; byte counts over raw `https` with `Accept-Encoding: gzip` and
**no client-side decompression**, so the counted bytes are what Supabase transmits.

| Endpoint (route-equivalent call) | Rows | Raw JSON B | **Wire (gzip) B** | Wire B/row | gzip ratio |
|---|---:|---:|---:|---:|---:|
| `get_home_feed_page` (all, limit 30) | 30 | 34,766 | **6,465** | 215.5 | 18.6% |
| `get_home_feed_page` (public, limit 30) | 1 | 1,167 | — | — | — |
| `get_sidebar_activity` | 44 | 16,404 | **3,004** | 68.3 | 18.3% |
| sidebar `communities` projection | 30 | 10,799 | **2,968** | 98.9 | 27.5% |
| sidebar mute projection | 25 | 2,101 | **1,111** | 44.4 | 52.9% |
| `get_all_communities` (**no LIMIT**) | 40 | 14,884 | **2,951** | 73.8 | 19.8% |
| `get_community_message_page` (p_limit 50) | 13 | 7,131 | **1,019** | 78.4 | 14.3% |
| `get_job_feed` (p_limit 51) | 4 | 14,403 | **5,842** | 1,460.5 | **40.6%** |
| `get_job_feed` per posting (card projection) | 4 | 1,696 | — | 424 | — |
| `get_profile_feed_page` (limit 30) | 10 | 12,011 | **3,087** | 308.7 | 25.7% |
| `get_member_feed_page` (limit 30) | 9 | 11,103 | — | 1,234 raw | — |
| `get_dm_conversations` | 3 | 1,908 | **686** | 228.7 | 36.0% |
| `get_dm_unread_total` | 1 | 1 | **3** | 3.0 | n/a |
| notifications list (limit 30) | 14 | 10,581 | **3,885** | 277.5 | 36.7% |
| admin companies (100 rows, `select *`) | 100 | 45,238 | **5,098** | 51.0 | 11.3% |
| `communities` `select(*)` (all active) | 55 | 35,492 | **6,307** | 114.7 | 17.8% |
| `designer_profiles` **full table, no limit** | 12 | 6,617 | **1,845** | 153.8 | 27.9% |
| `users` **full table, no limit** | 12 | 3,741 | **1,435** | 119.6 | 38.4% |
| `content_reactions` `(emoji,user_id)`, no limit | 4 | 265 | **145** | 36.3 | 54.7% |
| `search_companies` (limit 8) | 8 | 1,539 | **494** | 61.8 | 32.1% |
| community detail read model | 2 | 719 | **444** | 222.0 | 61.8% |
| community members page (30) | 6 | 868 | **397** | 66.2 | 45.7% |
| direct `POST`/`GET` latency per query | — | — | — | — | **322–493 ms** measured (Worker↔Supabase RTT) |

### 6.2 Per-row sizes of list content (route projections)

| Table | n | median raw B/row | max raw B/row | Source |
|---|---:|---:|---:|---|
| `job_posts` (`select *`) | 4 | **3,639** | 6,944 | MEASURED |
| `community_showcase_posts` (`select *`) | 12 | 726 | 1,453 | MEASURED |
| `community_threads` (13 route cols) | 10 | 588 | 1,245 | MEASURED |
| `notifications` (13 route cols) | 26 | 585 | 1,076 | MEASURED |
| `community_events` (card cols) | 10 | 433 | 465 | MEASURED |
| `community_resources` (11 route cols) | 2 | 427 | 427 | MEASURED |
| `thread_comments` (7 route cols) | 4 | 304 | 304 | MEASURED |

### 6.3 Live row counts — the scale caveat

Every table created in `supabase/migrations/` was counted (read-only `HEAD` counts, no row
transfer). These are the tables that hold any rows:

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `companies` | 573 | | `dm_conversations` | 10 |
| `company_domains` | 573 | | `showcase_likes` | 9 |
| `dm_messages` | 69 | | `dm_message_reactions` | 8 |
| `communities` | 55 | | `community_members` | 103 |
| `notifications` | 26 | | **`community_messages`** | **16** |
| `cities` | 41 | | **`job_posts`** | **4** |
| `signup_attempts` | 18 | | **`users`** | **12** |
| `push_throttle` | 19 | | `designer_profiles` | 12 |

**Total observed: on the order of 2,000 rows across all tables that hold any data; the
largest table is 573 rows and the second largest is 573. No table is close to the size
that would make the "under 1 GB" premise relevant.** This is a development-scale dataset.
Consequences:

- **No absolute egress can be measured from it.** It cannot produce hundreds of GB.
- **Per-request and per-row byte sizes *are* fully valid measurements** — they are
  properties of the schema, the projections and the compressor, not of the row count.
  That is why this audit reports bytes-per-call and treats frequency as an assumption.
- **If production is the same project**, then the egress concern is forward-looking and
  §5 is a forecast. **If production is a different project**, the audit's *shapes* still
  hold but its *totals* must be re-derived there. See §10 item U-1.

### 6.4 What could not be measured, and why

| Wanted | Status | Reason |
|---|---|---|
| Supabase egress metric / daily breakdown | **unavailable** | Requires the Supabase dashboard or Management API; no credential for it exists in this workspace |
| PostgREST request volume | **unavailable** | No request-log access; Supabase Log Drains not configured |
| `pg_stat_statements` (calls, rows, bytes per query) | **unavailable** | Not enabled/exposed; 0 references in `supabase/` and `apps/web` |
| Table/index sizes (`pg_total_relation_size`) | **unavailable** | No SQL access — PostgREST only, and no RPC exposes it |
| Cloudflare Worker request analytics / cache hit rate | **unavailable** | Requires a Cloudflare API token; not present |
| Cloudflare Workers Logs (`api.timing` JSON lines) | **unavailable** | Log sink is cloud-side only |
| Exact request counts per endpoint | **unavailable** | No analytics SDK in the repo (a deliberate finding of `docs/infrastructure-cost-audit.md` §1.12) |
| Storage/Realtime egress | **N/A** | Neither service is used |
| Response compression | **measured** | `content-encoding: gzip` on every response |
| Per-call wire bytes | **measured** | §6.1 |

**Explicit statement:** no Supabase dashboard metric was read, so **no actual monthly
egress figure is claimed as measured in this report.** Everything in §5 is a labelled
estimate built from measured per-call bytes; the repository contains
`estimateJsonBytes(...)` instrumentation on seven routes
([server-timing.ts](../apps/web/lib/server-timing.ts)) that already emits `response_bytes`
to Workers Logs — it is the right sensor, it just isn't reachable from here, and it only
covers 7 of 164 routes.

---

## 7. Current Supabase cost model and applicable free allowances

Verified from Supabase's own documentation (see sources below). **This application has no
Supabase Auth, Storage or Realtime usage**, so only the Database (PostgREST) contribution
to Egress applies, and the Realtime *message* and *peak-connection* meters are $0.

### 7.1 What counts

Supabase defines egress as data transmitted **out** of the system, across Database, Auth,
Storage, Edge Functions, Realtime and Log Drains. The plan allowance is a **Unified
Egress Quota** shared across services — but **cached and uncached egress are separate
quotas at separate rates**. Specifically:

| Question | Answer | Bearing on this app |
|---|---|---|
| Do PostgREST/API response bytes count? | **Yes** | This is 100% of our egress |
| Do Storage downloads count? | Yes | $0 — we use R2 |
| Does Realtime count (broadcast/presence/Postgres Changes/protocol frames)? | Yes | $0 — we use Cloudflare DO |
| Do internal Postgres disk reads / query processing count as egress? | **No** — egress is network transfer, not database I/O | Invalidates any "bytes read" reading of the bill |
| Do insert/update **request** payloads count? | **No** — only response bytes do | Supabase explicitly recommends not returning the whole row from a write; we do return whole rows in a few places (§4 #10) |
| Does pooler (Supavisor) traffic count? | It can, as **Shared Pooler Egress** | **Not applicable** — no direct Postgres client exists; traffic is PostgREST/Kong over HTTPS |
| Are cached and uncached egress priced the same? | **No** | We have no Storage CDN traffic, so **cached egress is $0** |

### 7.2 Allowances and rates

| Plan | Uncached egress included | Uncached overage | Cached egress included | Cached overage |
|---|---:|---:|---:|---:|
| Free | 5 GB | no paid rate listed (fair-use/notification) | 5 GB | — |
| **Pro (our plan)** | **250 GB** | **$0.09/GB** | 250 GB | $0.03/GB |
| Team | 250 GB | $0.09/GB | 250 GB | $0.03/GB |

Separate Realtime meters (not applicable here, listed for completeness): messages 5M/mo
included on Pro then $2.50/M; peak connections 500 on Pro then $10/1,000.

Compute (independent of egress): Micro ≈ $10/mo, Small ≈ $15/mo, Medium ≈ $60/mo; paid
plans include $10/mo of compute credit. Compute size does **not** change the egress quota
or rate — it changes query speed, which is a latency concern, not an egress one.

### 7.3 Applying it here

- **Billable egress = gzip wire bytes of PostgREST responses** (§6.1).
- Cached egress = $0; Storage/Realtime/Auth = $0; logs drain = not configured.
- Pro's **Spend Cap is on by default**: past 250 GB, behaviour depends on the cap setting
  (blocked/notified vs. charged at $0.09/GB). Worth confirming in the dashboard — it
  decides whether a traffic spike is a cost event or an outage. — **ESTIMATE (setting not visible here)**

| Scenario | Monthly egress | Billable over 250 GB | Egress overage @ $0.09/GB |
|---|---:|---:|---:|
| Expected @ 10K DAU | 111.8 GB | 0 | **$0.00** |
| Expected @ 100K DAU | 1,118 GB | 868 GB | **$78.16** |
| High @ 10K DAU | 408.7 GB | 158.7 GB | **$14.28** |
| High @ 100K DAU | 4,086.6 GB | 3,836.6 GB | **$345.29** |

*$0.09/GB is Supabase's published Pro uncached-egress rate, not a hypothetical.* The
distinction between gross and billable egress is the 250 GB allowance: at 10K DAU the
expected scenario is **inside the free allowance entirely**, which is the practical
takeaway — egress is not today's bill line unless the live dataset is far larger than
the one reachable here.

---

## 8. Recommended optimizations

Each entry: expected benefit, trade-offs, complexity, risk. All are compatible with the
current architecture; **none requires leaving Supabase.**

**8.1 Select only the columns the UI needs** — *the single highest-value, lowest-risk
change.* The jobs feed is the proof: `description` is 81% of the row and is on no card.
Replace `select("*")` (12 sites) and trim the feed RPC payload.
*Benefit:* ~19.6% of egress (jobs) + several % elsewhere. *Trade-off:* the detail page
must still fetch the full row (it already does, via `get_job_detail`).
*Complexity:* low–medium (SQL payload change + type update). *Risk:* low; a missing column
fails loudly in TypeScript. *Verify:* `X-Response-Bytes`/`response_bytes` before/after.

**8.2 Cursor pagination and incremental fetching** — already excellent for chat
(`?after=` compound cursor), events, threads, resources, showcase, jobs and DM. The
**gaps are `get_all_communities` (no LIMIT), `get_sidebar_activity` (no LIMIT), the four
comment lists, and the unbounded reaction reads.**
*Benefit:* converts #2 and #7 from platform-scaling to constant. *Trade-off:* clients
need incremental loading; Explore already has tab filters to key the cursor on.
*Complexity:* medium (SQL + client). *Risk:* medium — cursor correctness is subtle
(the repo has dedicated cursor tests, so the pattern and its tests already exist).

**8.3 Deduplicate concurrent requests** — already implemented and effective
(`request-cache.ts` in-flight map, `dedupe-fetch.ts`, `content-event-ids.ts` in-flight
dedup, React `cache()` on the read model).
*Residual:* the rail and sidebar independently invoke `get_all_communities` /
`get_sidebar_activity` on the same page load; `fetchAndHydrateCommunityBootstrap` and
`fetchMeta`/`fetchMessages` can overlap on a cache miss.
*Benefit:* small. *Complexity:* low. *Risk:* low (must not collapse distinct cursors).

**8.4 Reuse server-rendered data on the client** — already done well: SSR props seed
`metaCache`/`msgCache`, the bootstrap sections are written into the request cache, and
`COMMUNITY_BOOTSTRAP_STALE_MS = 15 min` prevents the classic "SSR fetch then client
fetch immediately".
*Residual:* the jobs board is SSR'd with the full payload and the pager endpoint repeats
it; profile pages re-read on mount. *Benefit:* small–medium. *Risk:* low.

**8.5 Fix cache keys, freshness and invalidation** — keys are already canonicalised
(sorted params) and per-user; staleness is deliberate (feed 10 s server, 60 s client;
sidebar 60 s; notifications 30 s; master data 1 h).
*Residual gaps:* `/api/communities/all` is **not** server-cached while the rail's call to
the same RPC is; the home feed's 10 s `unstable_cache` is per-user so it dedupes
concurrency but not repeat visits; nothing shortens the mark-all-read pre-read.
*Benefit:* medium for Explore. *Complexity:* low. *Risk:* low (serve slightly stale
Explore data; it already has a 5-minute client window).

**8.6 Reduce N+1** — **largely already solved** via aggregate RPCs
(`get_thread_list_aggregates`, `get_event_list_aggregates`, `get_resource_list_aggregates`,
`get_showcase_interactions`, `get_event_attendee_previews`, batched `attachUsers`).
Remaining batched-but-wide pattern: message page carries its own `users` blob per row
(26% of the page). *Benefit:* ~1.4% + smaller CPU. *Complexity:* low–medium.

**8.7 Batch related queries** — already the norm (`Promise.all` waves, `Promise.allSettled`
in bootstrap). *Residual:* bootstrap bundles four sections and pays for the message page
on every tab-independent open. A `?section=` variant would let a thread-only open skip chat.
*Benefit:* medium if tabs are opened cold often. *Complexity:* medium. *Risk:* medium
(cache-key changes; the request cache keys are path-based, so a new query param creates
new entries — the bootstrap-entry aliasing in `getBootstrapBackedRequest` must be kept
consistent).

**8.8 Cloudflare Cache / Workers caching for public data** — **the highest-leverage
untapped lever, and it costs nothing in Supabase egress.** Company directory, public
threads/showcase/resources/events, master data and the jobs board (when the viewer is
not a member) are the same for many users. `unstable_cache` already uses the R2-backed
incremental cache, so the mechanism exists.
*Benefit:* potentially large (kills the per-user multiplication on public pages).
*Trade-off:* must key by viewer for anything viewer-flagged (`joined`, `user_liked`) —
the aggregate RPCs return per-viewer flags, so public caching applies only to genuinely
viewer-independent payloads. *Complexity:* medium. *Risk:* **security-relevant** — a
mis-keyed public cache leaks another user's flags; requires `Vary`/key discipline and
`private, no-store` on anything personalised.

**8.9 Keep private data correctly authorized** — currently strong: service-role only on
the server, per-user request-cache keys, `isSameOriginRequest` checks, 20/10 s + 120/60 s
global limits, per-route limits. Two things to preserve during any caching work: the
write-through mark-read paths, and the fact that RLS is bypassed (so **no route may trust
a client-supplied id**). *Any* new shared cache is the main new risk surface this audit's
recommendations introduce.

**8.10 Avoid Postgres for what Durable Objects already do** — already done: presence,
typing, broadcast and unread fan-out are all DO-based; the realtime publication is retired and
there are no `notifications` rows for chat broadcasts (engagement-only, deferred).
*No change recommended.* Reintroducing a realtime publication anywhere would create a **new** egress
category, a per-message meter and a peak-connection meter — the current design avoids all
three.

**8.11 Prevent realtime events from triggering full-history fetches** — already largely
handled (incremental `?after=` catch-up, 300 ms debounce, bounds on pages/passes/retries,
5 s hidden threshold). The two remaining realtime→fetch triggers are the DM badge refetch
(`get_dm_unread_total`, 1-byte response — negligible egress) and reaction/comment
refreshes. *Benefit:* small for egress, real for request count. *Risk:* low.

**8.12 Indexes and query plans** — outside this audit's measurable scope (no planner
access). Noting only that all measured calls returned in **322–493 ms** on a 1.4k-row
database, which is *network* latency to the region, not plan cost, and that query
processing is **not** egress. Index work helps latency and compute; it will not move the
bill. *Recommendation:* do not spend egress-reduction effort here.

**8.13 Hosting evaluation** —
- **Optimize Supabase: yes, first.** §8.1/8.2/8.5 remove ~32% with no architecture change.
- **Neon PostgreSQL: not justified by this evidence.** Neon would change the *price of the
  same bytes*; it would not stop the jobs board from sending 73 KB of descriptions or
  `get_all_communities` from sending the whole table. Migration cost is high and concrete:
  190 migrations, 72 SQL functions, RLS policies, the compound-cursor RPCs, verification
  flows and `security invoker`/`security definer` semantics all have to be re-validated
  against a new engine and driver. Revisit **only** if measured egress overage is
  material *after* §8.1–8.5.
- **Cloudflare D1: do not.** Assessed on compatibility, not price: a ~1 GB database with
  190 migrations, 72 functions, heavy joins, jsonb payload building, CTEs, `security
  invoker` and transactional verification flows is not a D1-shaped workload.
- **Migrate selected workloads to Cloudflare:** the right *shape* of answer — and the
  right targets are the ones that are **already** Cloudflare (R2 media, DO realtime). A
  further candidate is read-heavy, publicly cacheable content behind Cloudflare Cache
  (§8.8), which removes Supabase egress without changing the datastore.

---

## 9. Expected egress and cost, before versus after

| Scenario | Monthly egress | Estimated monthly cost | Assumptions |
|---|---:|---:|---|
| **Current baseline (expected mix, 10K DAU)** | **111.8 GB** | **$0.00 overage** (inside Pro's 250 GB; plan $25 + compute) | measured per-call bytes × the §5 mix; gzip included |
| **Current baseline (expected mix, 100K DAU)** | **1,118 GB** | **$78.16 overage** | same mix, linear in DAU |
| **Current baseline (high mix, 100K DAU)** | **4,086.6 GB** | **$345.29 overage** | heavy multi-community users |
| **After quick fixes (8.1, 8.2, 8.5, plus the notification pre-read)** | **≈ −32%: 75.8 GB @10K, 758 GB @100K** | **$0 @10K; ≈ $45.7 @100K** | same mix; card-only job projection, Explore LIMIT+cursor, comment/reaction caps, mark-all-read fix |
| **After major optimizations (add #8.8 public caching, section-scoped bootstrap, chat projection)** | **≈ −55–65%: ~40–50 GB @10K, ~400–500 GB @100K** | **$0 @10K; ≈ $14–23 @100K** | adds Cloudflare Cache on viewer-independent payloads + tab-scoped bootstrap; **upper bound is an ESTIMATE** |

Sensitivity to the single biggest unknown: doubling the frequency mix doubles the bytes
and pulls the 250 GB crossing from ~23K DAU to ~11K DAU (expected mix). Halving
per-call bytes via the fixes above doubles that headroom again.

---

## 10. Risks, unknowns and instrumentation required

### Unknowns that most affect the answer

| ID | Unknown | Why it matters | How to resolve |
|---|---|---|---|
| **U-1** | **Is `eauupthwlnarkauwifmw.supabase.co` production?** It holds 12 users / 16 chat messages / 4 job posts. | Decides whether §5 is a forecast (young app) or a mis-scoped audit. Everything else hinges on this. | Compare the Supabase project ref in the dashboard against `NEXT_PUBLIC_SUPABASE_URL` in `wrangler.toml`; run the §12 probe against production |
| **U-2** | Actual calls per DAU-day per endpoint | The only low-confidence input; drives a 20× spread (§5) | Enable Logpush/Workers Logs tail and aggregate the existing `api.timing` lines by `route` |
| **U-3** | Whether Pro's Spend Cap is on | Determines whether a spike is a bill or an outage | Supabase dashboard → Billing |
| **U-4** | Real-world row sizes for jobs/threads/comments (dev rows are short) | Long descriptions and 5,000-char comment bodies compress worse than this dataset's | Re-measure §12 on production rows |
| **U-5** | Whether PostgREST egress is metered pre- or post-compression | We measured gzip on the wire; if metered pre-compression, multiply all totals by ~2.7–7× | Supabase support, or reconcile §5 against the dashboard's Egress graph |
| **U-6** | Whether Cloudflare re-compresses or re-uses the gzip body Worker→browser | Billing is on the Supabase leg only, so it should not matter | Confirm no double-counting in the dashboard's breakdown |

### Risks in the current implementation

1. **Platform-scaling reads** (`get_all_communities`, `get_sidebar_activity`) — cost grows
   with total communities / memberships, not with traffic. Silent until the platform grows.
2. **Unbounded per-item reads** (comments, reactions, notifications mark-all-read) — a
   single viral thread or a 5,000-item inbox becomes a multi-MB response.
3. **Prose in list payloads** — the jobs board; worst compression ratio measured (40.6%).
4. **Coverage gap in existing instrumentation** — `estimateJsonBytes` is on 7 of 164
   routes; the biggest offenders (jobs feed, `get_all_communities`, comment routes) are
   **not** instrumented, so the sensors do not currently watch the top hotspots.
5. **RLS is bypassed by design** (service-role everywhere). Any shared cache added under
   §8.8 becomes the primary isolation risk.

### Instrumentation required to replace estimates with measurements

1. **Per-route response bytes on every route** — extend the existing
   `createServerTimer(...).finish({ response_bytes })` pattern
   ([server-timing.ts:67](../apps/web/lib/server-timing.ts#L67)) from 7 routes to all 164, and
   to SSR pages. This is the single highest-value addition: it turns §5 from ESTIMATE into
   MEASURED with one deploy.
2. **A Cloudflare Logpush (or Workers Logs tail) sink** for the `api.timing` JSON lines so
   they can be aggregated — no new vendor needed, the lines already exist.
3. **Supabase-side, read-only:** enable `pg_stat_statements` and expose
   `calls`, `rows`, `total_exec_time` through an admin-only, service-role RPC; optionally a
   `pg_total_relation_size` reporter. Query *processing* is not egress, but it is the
   other half of "why is this expensive".
4. **A cache-hit-rate counter** — `getRequestCacheTelemetry()` already computes
   `hit_rate` ([request-cache.ts:45](../apps/web/lib/request-cache.ts#L45)) but nothing
   reads it; surface it on the existing admin health page.
5. **Supabase Management API access** (read-only) to pull the egress metric
   programmatically and reconcile it against §5.

**Explicit limitations of this audit:** no dashboard metric, no request counts, no
planner output, and a development-scale source dataset were available. Byte-per-call
figures are measured and reproducible; **monthly totals are estimates and are labelled as
such**. No savings figure in §8–§9 should be treated as verified until instrument 1 above
is in place.

---

## 11. Prioritized implementation roadmap

**P0 — establish the baseline (measurement first, no behaviour change)**
1. Resolve **U-1**: confirm which Supabase project production uses; re-run the §12 probe there.
2. Read the Supabase **Egress** graph and record the last 30 days (uncached vs cached), plus the Realtime/Storage lines to confirm they are 0.
3. Extend `response_bytes` instrumentation to all routes and SSR pages; aggregate it via Logpush.

**P1 — the three fixes that need no architecture change (≈ 27% of modelled egress)**
4. **Jobs board card projection** (§8.1): drop `description`/`responsibilities`/`requirements`/`skills` from `get_job_feed`; keep them in `get_job_detail`. *~19.6%, medium effort, low risk.*
5. **`get_all_communities`: `LIMIT` + keyset cursor**, and `unstable_cache` the Explore route as the rail already is. *~9.4%, medium effort, low risk.*
6. **Notifications mark-all-read**: run the `UPDATE` unconditionally; select only `id` for the realtime payload. *~2.1%, low effort, low risk.*

**Status of P1 (updated after implementation).** Items 4–6 are in the codebase: the jobs feed
returns card-shaped rows and the detail read keeps the prose
(`20261015140000_job_feed_card_payload.sql`), the Explore directory is a bounded keyset page
behind a per-member cache and the homepage rail moved to its own bounded top-N read
(`20261015150000_all_communities_cursor.sql`, `apps/web/lib/communities/explore-page-server.ts`,
`get_suggested_communities`), and mark-all-read is one statement whose realtime payload carries
only ids. **P0 items 1–3 are still outstanding** — until the per-route byte counts and the
dashboard's own egress graph are read, the percentages above remain estimates, including the
ones this implementation is credited with. (The same caveat now applies to the P2 figures below:
where a measurement was taken on a development-scale page, it says so.)

**P2 — bound the remaining unbounded reads**
7. Comment cursors + grouped reaction counts (`emoji → count`) + caller-only reaction rows, across threads/resources/showcase/events. *~1.4% now, caps a viral-thread blow-up.*
8. Chat page projection: stop embedding the per-message `users` blob (client already has members). *~1.4%.*
9. Resource list 100 → 30; drop `attachments`/`links`/`poll` from the thread list projection.

**Status of P2 (updated after implementation).** Partly landed:

* **Item 7, reaction counts — done.** Comment reactions are aggregated in SQL
  (`20261015160000_comment_reaction_summaries`): one row per `(comment, emoji)`
  carrying the group's size and whether the caller is in it, instead of one row
  per person. The payload the UI consumes is unchanged (a pill is a count plus
  the caller's own highlight — nothing renders *who* reacted), so this is a pure
  read change, and the toggle route's re-read is an aggregate now too.
* **Item 7, comment cursors — outstanding.** The four comment lists still read
  every comment on an item. This is the piece that caps a viral thread, and it
  needs all four surfaces' clients paged with the read, not just the SQL side.
* **Item 8 — done, but smaller and differently than written.** The recommendation
  assumed the client could resolve authors from the members it already has; that
  is **not** true here — the chat's member list is the ten most recent members
  (`apps/web/lib/communities/read-models.ts`) while a room's history is written by
  everyone, including people who have left. Deleting the blob would have turned
  most names in a busy room into the "Member" placeholder, so the author is
  resolved once per page instead (`20261015170000_message_page_author_map`): an
  `authors` map for the page's distinct authors, attached to a single row like
  `content_reactions`, with the loader filling each message's `users` from it. A
  page now pays per author rather than per message, so the saving is real on a
  busy page and ~zero on a page where every message has a different author —
  smaller than this document's **1.4%** claim, which was measured against a
  13-row, 13-author development page.
* **Item 9 — not started.**

**P3 — structural headroom**
10. Section-scoped `?section=` bootstrap so a non-chat tab does not pay for the message page.
11. Cloudflare Cache on viewer-independent public payloads (company directory, public content, master data) — **with an explicit isolation review**, since RLS is bypassed and per-viewer flags must never be shared.
12. Re-read §5 against the dashboard with P0's data and decide whether any egress work is still warranted. **Only then** evaluate Neon, and only for measured overage.

---

## 12. Reproducing the measurements

Every MEASURED number above comes from read-only calls; the wire probe uses `node:https`,
which does **not** auto-decompress, so the counted bytes are what Supabase transmits.
Rows, ids and credentials are never printed.

```js
// node --input-type=module  (run from the repo root; needs apps/web/.env.local)
import { readFileSync } from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require(`${process.cwd()}/node_modules/@supabase/supabase-js`);
const env = Object.fromEntries(
  readFileSync("apps/web/.env.local", "utf8").split("\n").flatMap((l) => {
    const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(l.trim());
    return m ? [[m[1], m[2].replace(/^["']|["']$/g, "")]] : [];
  }),
);

// 1. Row counts (read-only HEAD counts — no row transfer).
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
for (const t of ["users", "communities", "community_messages", "job_posts", "notifications"]) {
  const { count } = await db.from(t).select("*", { count: "exact", head: true });
  console.log(t, count);
}

// 2. True on-the-wire (gzip) bytes for one route-equivalent call.
function wire(path, method = "GET", body = null) {
  return new Promise((resolve) => {
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({ host, path, method, headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Accept-Encoding": "gzip, br",
      ...(payload ? { "Content-Type": "application/json",
                      "Content-Length": Buffer.byteLength(payload) } : {}) } },
      (res) => { let n = 0; res.on("data", (c) => { n += c.length; });
        res.on("end", () => resolve({ status: res.statusCode,
          encoding: res.headers["content-encoding"] ?? "(none)", wireBytes: n })); });
    if (payload) req.write(payload);
    req.end();
  });
}
const { data: u } = await db.from("users").select("id").limit(1);
console.log(await wire("/rest/v1/rpc/get_all_communities", "POST", { p_user_id: u[0].id }));
```

The static inventory numbers in §2 come from two read-only scanners: one walking every
`.from("table")` chain (690 sites; classifying 502 reads as bounded/unbounded, 7 with no
filter) and one matching `callPerformanceRpc(client, "name", …)` (43 sites, 38 RPCs).

### Source list for §7 (Supabase pricing and egress rules)

- https://supabase.com/docs/guides/platform/manage-your-usage/egress — what egress is, per-plan quotas, $0.09/GB uncached and $0.03/GB cached, API/Auth/Storage/Realtime/Log-Drain components
- https://supabase.com/docs/guides/troubleshooting/realtime-egress-faq — Realtime egress includes Broadcast, Postgres Changes, Presence and protocol frames
- https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages — 5M messages/mo on Pro, then $2.50/M
- https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections — 500 peak connections on Pro, then $10/1,000
- https://supabase.com/docs/guides/platform/manage-your-usage/compute — Micro ≈ $10, Small ≈ $15, Medium ≈ $60 per month; $10/mo compute credit on paid plans
- https://supabase.com/docs/guides/troubleshooting/all-about-supabase-egress-a_Sg_e — Shared Pooler Egress and the no-double-counting note
- https://supabase.com/pricing — plan allowances and overage rates

---

## Appendix — answers to the five required questions

**1. Which feature generates the most Supabase egress?**
The **jobs board**. It is the largest measured payload per request in the application
(1,460 B on the wire per posting → ~73 KB per 50-row page by mean row, ~88 KB at the
median, ~153 KB worst case) and it is the **worst-compressing** payload measured (40.6%
gzip, versus 14–20% for key-heavy JSON), because 81% of each row is prose that the board
cards never render. In the expected mix it is ~19.6% of modelled egress from a single
visit per DAU, rising to ~21.4% in the high mix. The nearest runner-up is the community
bootstrap (17.0%), and the largest *structural* risk is `get_all_communities` (9.9%
today, but the only hotspot that scales with the platform rather than with usage).

**2. Which exact query or endpoint is responsible?**
`get_job_feed`, called from two places: the SSR board
([jobs/page.tsx](../apps/web/app/dashboard/jobs/page.tsx) via
[jobs/service.ts:217](../apps/web/lib/jobs/service.ts#L217)) and the pager
([jobs/feed/route.ts:39](../apps/web/app/api/jobs/feed/route.ts#L39), which calls it with
`JOB_FEED_PAGE_SIZE + 1 = 51`). The RPC returns, per posting, `description` +
`responsibilities[]` + `requirements[]` + `skills[]` alongside the card fields the board
actually renders, for every row in the page. Secondary: `get_all_communities`
(no `LIMIT`, migration
[20261012140000_explore_pending_join_request.sql](../supabase/migrations/20261012140000_explore_pending_join_request.sql)),
`get_sidebar_activity` (no `LIMIT`), and the unbounded
[notifications mark-all-read](../apps/web/app/api/notifications/route.ts#L67-L70).

**3. How many GB per month does it generate?**
**Measured per request: 1,460 B on the wire per posting (5,842 B for a 4-posting page);
~73 KB per 50-row page.** The monthly figure depends entirely on view frequency, which is
**ESTIMATE** because no request-count telemetry is reachable from this workspace. At the
expected mix (1 board view per DAU per day): **2.19 GB/month at 1K DAU, 21.9 GB/month at
10K DAU, 219 GB/month at 100K DAU** — about one fifth of total application egress.
At the high mix (4 views/DAU) it is **876 GB/month at 100K DAU**. It would become the
**first** feature to break the 250 GB Pro allowance on its own at roughly 11K DAU in the
high mix, or ~115K DAU in the expected mix.

**4. The three highest-impact fixes that preserve the current architecture?**
1. **Trim the jobs feed to a card projection** — remove `description`,
   `responsibilities`, `requirements` and `skills` from `get_job_feed` and keep the full
   posting only in `get_job_detail`. Measured card-only row: 424 B vs 3,639 B raw (~1/8.5).
   Worth **~19.6%** of modelled egress; medium effort, low risk.
2. **Bound the platform-wide reads** — add `LIMIT` + keyset cursor to `get_all_communities`
   and `get_sidebar_activity`, and `unstable_cache` the Explore route the way the home
   rail already caches the same RPC. Worth **~9.4%** now, and it is the only fix that
   removes a cost that grows with the platform rather than with traffic. Medium effort,
   low risk.
3. **Stop the unbounded notification pre-read** — `PATCH /api/notifications {all:true}`
   should run its `UPDATE` unconditionally and select only `id` for the realtime payload
   instead of every unread row's `body`. Worth **~2.1%**, removes the only per-click
   multi-MB read in the app; low effort, low risk.

(Together ≈ 32% of expected-scenario egress, taking 10K-DAU from 111.8 GB to ~75.8 GB —
no architecture change, no new vendor, three files and two SQL payloads.)

**5. Optimize Supabase, migrate to Neon, or move selected workloads to Cloudflare?**
**Optimize Supabase first — the evidence does not support a migration.** The egress is not
a database-engine problem: it is six specific payloads that ship more bytes than the UI
renders. Moving to Neon would re-price the same bytes while adding 190 migrations, 72 SQL
functions, RLS policies, the compound-cursor RPCs and transactional verification flows to
re-validate — and at the measured baseline the app is *inside* the Pro allowance at 10K
DAU (~111.8 GB of 250 GB) with zero egress overage. **Cloudflare is the right place to
move specific workloads** — media already is (R2, free egress), realtime already is
(Durable Objects, $0 Supabase), and the next candidate is Cloudflare Cache in front of
viewer-independent public content, which removes Supabase egress without touching the
datastore. **D1 is not a candidate**: a ~1 GB Postgres schema with heavy joins, jsonb
payload construction, CTEs, `security invoker`/`definer` functions and RLS is not a
D1-shaped workload, and its different egress pricing does not address the cause.
**Do the three fixes above, instrument all 164 routes, re-measure against the dashboard —
and only if measured overage is still material after that should Neon be on the table.**
