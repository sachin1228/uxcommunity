# Web-vs-mobile parity notes — Jobs, Events, Companies

Read-only audit of `apps/web` (Next.js App Router) for the mobile (Expo Router / React Native) parity
project. Mobile source of truth cross-check: `expo-app-standalone 3/` — the Jobs tab today is a
placeholder (`expo-app-standalone 3/app/(tabs)/jobs.tsx:15` "Jobs — coming soon"), and the mobile API
client already replays the web session cookie against the same `/api/**` backend
(`expo-app-standalone 3/lib/api.ts:119-171`), including multipart uploads via `apiFormUpload`
(`expo-app-standalone 3/lib/api.ts:43-86`).

All citations are `path:line` relative to the repo root unless stated otherwise. Nothing in this
document is aspirational — every rule was read out of the shipped code.

---

## Feature table

| Feature | Web pages | API endpoints (method path) | Auth/roles | Key business rules & edge cases | Realtime | Mobile-relevant constraints | Suggested mobile priority |
|---|---|---|---|---|---|---|---|
| Jobs browse (board) | `/dashboard/jobs` (`apps/web/app/dashboard/jobs/page.tsx`) | `GET /api/jobs/feed?before=<created_at>\|<id>` (`apps/web/app/api/jobs/feed/route.ts:18`); RSC first paint via RPC `get_job_feed` | Signed-in `role=user`; redirect `/login` otherwise (`page.tsx:16-18`) | 4 tabs Hiring/Referral/Applied/My posts; browse tabs show only `can_apply` roles of other members; own posts only in My posts; applied move to Applied; closed/expired roles stay visible only to their owner; client-side search only; cursor 50/page; "N new" badges from localStorage | None (no jobs room; feed refetched by RSC navigation) | All data is JSON already; feed is the only list endpoint (no SSR needed) | **P1** |
| Job detail | `/dashboard/jobs/[jobId]` (`apps/web/app/dashboard/jobs/[jobId]/page.tsx`) | RPC `get_job_detail` only; no public GET route (see "server changes") | Signed-in user | Same payload as card + full description/lists; Apply gated by `can_apply`; applied → Application status card; closed vs expired states; owner controls (edit/close/delete) | None | **No JSON endpoint exists for a single job** — mobile needs a new GET route (or reuse `/api/jobs/feed` pages) | **P1** |
| Apply to a job | Modal on detail (`apps/web/components/jobs/ApplyModal.tsx`) | `POST /api/jobs/[id]/apply` **multipart/form-data** (`apps/web/app/api/jobs/[id]/apply/route.ts:38`) | Signed-in user; session id is the applicant | name 2–120; portfolio http(s); linkedin.com URL; resume required (upload ≤5 MB PDF/DOC/DOCX/RTF, or `saved_resume_id`); R2 upload before the RPC, deleted if the apply fails; first upload adopted into `member_resumes`; failures 401/403/404/409/415/422/503 | None | `multipart/form-data` required (415 otherwise); RN must send real FormData (mobile `apiFormUpload` already does); no JSON payload support | **P1** |
| Saved resumes | Settings → Job profile (`/dashboard/settings/job-profile`, resume picker in ApplyModal) | `GET/POST/PATCH/DELETE /api/settings/resumes` (`apps/web/app/api/settings/resumes/route.ts:84,96,205,274`) | Signed-in user | Up to `MAX_SAVED_RESUMES`; every mutation returns the refreshed `{resumes}` list; `is_default` | None | Plain JSON; needed for one-tap apply on mobile | **P2** |
| Post a job | `/dashboard/jobs/new` (`apps/web/app/dashboard/jobs/new/page.tsx`) | `POST /api/jobs` (JSON) (`apps/web/app/api/jobs/route.ts:36`) | Signed-in user **with a verified company membership** | Requires `company_members.verified`; company must be active; kind hiring\|referral fixed at create; city/sector nullable = "All"; job_title + experience_level mandatory exact; description rich-text ≤8000 plain chars; 20×(200/60)-char lists; monthly limit 1 job/UTC month (429) | None. Notification fan-out: `job_match` to all matching profiles | JSON body is mobile-friendly; needs company search + verify flow (see Companies) | **P1** |
| Job management (owner) | My posts tab + job detail owner menu (`apps/web/components/jobs/JobOwnerActions.tsx`) | `POST /api/jobs/[id]/edit`, `POST /api/jobs/[id]/status`, `DELETE /api/jobs/[id]` | Poster only (DB re-checks) | Edit cannot change kind/company; city+sector+job_title+experience_level freeze once any application exists (409 `criteria_locked`); `closes_at` freely movable; close/reopen reversible (reopen clears a passed deadline); delete irreversible, applications cascade | None | All JSON; optimistic undo patterns are web-only niceties | **P2** |
| Applicants board | `/dashboard/jobs/[jobId]/applicants` (`apps/web/app/dashboard/jobs/[jobId]/applicants/page.tsx`) | RPC `get_job_applicants` only; **no GET API route** | Poster only; non-owner redirected to the posting | Returns each application as submitted (name, portfolio, linkedin, resume, avatar, `applied_label`, `status`); roles/city enriched server-side (`loadJobApplicantDetails`) | None | **No JSON endpoint** — mobile needs a GET route for the applicants list | **P2** |
| Application triage | Buttons on applicants board + design view | `POST /api/jobs/[id]/applications/[applicationId]/status` (JSON body `{status}`) (`apps/web/app/api/jobs/[id]/applications/[applicationId]/status/route.ts:31`) | Poster only (checked through the application's own job) | Statuses `new`/`shortlisted`/`rejected`, freely reversible; no timestamps; response echoes stored status | None | Simple JSON; undo toasts are web-only | **P2** |
| Design-mode application viewer | `/applications/[jobId]/[applicationId]` — outside `/dashboard` (`apps/web/app/applications/[jobId]/[applicationId]/page.tsx`) | No own API; reads `get_job_applicants` + `designer_profiles` + `member_resumes`/R2 URLs | Poster only (redirects non-owner) | Web-only design experiment: sidebar + chosen link in an iframe (portfolio), own pdf.js viewer for resume PDFs, LinkedIn refuses framing, forced dark palette, prev/next across applicants, triage buttons | None | **Web-only experiment.** Underlying data = applicants list + resume URLs. Do not port the viewer; port the data surface | web-only |
| Jobs admin / moderation | `/admin/(protected)/jobs` | `GET /api/admin/jobs`, `DELETE /api/admin/jobs/[id]` | `role=admin` (`apps/web/app/api/admin/jobs/route.ts:29`) | Queue of all postings w/ poster, company, applicants; filters all/open/closed/expired; delete = moderation removal | None | **Web-only** (admin back-office) | web-only |
| Events browse (city) | `/dashboard/events` (`apps/web/app/dashboard/events/page.tsx`) + city Events page component | `GET /api/events/city?cursor=phase\|event_date\|id&type=online\|in-person&from&to` (`apps/web/app/api/events/city/route.ts:16`) | Signed-in user; city = viewer's **own profile city** (client never names it) | Only `is_public` events with `city_id` = viewer city; upcoming/past over `coalesce(end_date, event_date)`; filters by type + start-date window, applied in SQL; 25/page; no city → "No city on your profile yet" empty state (API 422) | None (city page deliberately has no community room) | JSON ready; mobile must read the user's profile city first | **P1** |
| Event detail | `/dashboard/events/[eventId]` (`apps/web/app/dashboard/events/[eventId]/page.tsx`) | `GET /api/communities/[id]/events/[eventId]` returns `{event}` (`apps/web/app/api/communities/[id]/events/[eventId]/route.ts:22`); RSVP/like/save/list siblings | Signed-in user; public event = any member opens it; non-public event requires membership of the underlying community (`page.tsx:45`) | Ticket card: date/time on the **viewer's clock** (zone on hover title), host-time line when different, Online (meet link) vs location, spots remaining, avatar stack, RSVP button (Going / Event Full / "has ended"); Join/Open event chat row hidden once ended; comments; report; share; edit/delete owner-only | Subscribes `events:<communityId>` on the community tab; detail page fetches comments and RSVPs | JSON route needs the community id; every event row carries `community_id` (NOT NULL since `supabase/migrations/20260830100000_remove_standalone_public_posts.sql:18-19`; the `"public"` scope branches are legacy/defensive) | **P1** |
| RSVP (Join / Going) | EventCard going button + confirm dialog + join questions (`apps/web/components/communities/events/EventCard.tsx:351-440`) | `POST /api/communities/[id]/events/[eventId]/rsvp` (`apps/web/app/api/communities/[id]/events/[eventId]/rsvp/route.ts:19`) | Signed-in user (no membership check on RSVP itself) | Toggle: existing row → delete (+leave room); else capacity check → insert; host auto-RSVPed at create; join also creates/joins the group chat and stores the host's questions; leave never removes the room owner; `event_rsvp` notification to host | Publishes `events:<communityId>` topic `rsvp` (INSERT/DELETE); home feed tag revalidated | Body `{answers}` optional for RSVP (answers stored only if complete) — one-tap RSVP legal; `chat` route requires them | **P1** |
| Event group chat (room) | `/dashboard/communities/[id]` for an `event`-type room (layout auto-routes) | `POST /api/communities/[id]/events/[eventId]/chat` (join/create, answers required) (`apps/web/app/api/communities/[id]/events/[eventId]/chat/route.ts:28`); `GET /api/communities/[id]/event` (info card) (`apps/web/app/api/communities/[id]/event/route.ts:20`) | Any member who can see the event; room membership required for the info card | Room is a normal community (`type='event'`, `event_id` link), created on demand, **`is_private: false` always**, `enabled_tabs:["chat"]`, showcase off; door closes when the event ended; owner-only "carry-on" offer 12 h after end when room untouched; chat watermark = event title (web design) | Room chat rooms `chat:<roomId>` (`message*`, `typing`); `content-insert` "created an event" card | Chat parity is a separate workstream; the event-side API is JSON | **P2** |
| Event creation | Community Events tab → Create Event modal (`apps/web/components/communities/events/CreateEventModal.tsx`) | `POST /api/communities/[id]/events` (JSON) (`apps/web/app/api/communities/[id]/events/route.ts:113`); cover via `POST /api/communities/[id]/events/upload` | Any **member of the community** (403 otherwise); creation limit 1 event/UTC month (429) | Title ≤120 required; description optional in API but **required by the web form**; cover **required by the web form**; start zone-aware ISO required, past start refused (60 s grace); end after start; `city_id` required; `is_online` bool; meet_link URL; `max_attendees` >0; accent `#RRGGBB`; host RSPVs + room created; poster-left layout is web-only | Publishes `events:<communityId>` topic `event` + chat `content-insert` card | Cover upload is multipart; rest JSON. No create entry point on the city Events page (web) | **P2** |
| Event edit / delete | Owner options menu on the card; moderator delete | `PATCH` / `DELETE /api/communities/[id]/events/[eventId]` (`route.ts:50,228`) | Owner; delete additionally any manager with `can_moderate_events` (non-public scope) | PATCH partial; host timezone rewritten only when the start moved; city can't be cleared; cover R2 cleanup; room name/cover follow only while the room still wears the event's clothes; moderated delete writes audit + `event_deleted` notice; room survives deletion | `events:<communityId>` (+ the room's `events:<roomId>` topic when the room exists) | JSON; R2 cover lifecycle server-side | **P2** |
| Event like / save / comments / RSVP list | Card buttons, comment section, attendee stack | `POST .../like`, `POST .../save` `{saved}`, `GET/POST .../comments`, `GET .../rsvp/list` | Signed-in member | Like/save toggles validated against persisted state (save confirms after write); comments ≠ engagement merge; saves appear on `/dashboard/saved` (threads/showcase/resources/events only) | `like` and `save` topics on `events:<communityId>` | JSON; mobile home feed already does some of this (`MA/lib/homeFeed.ts`) | **P3** |
| Events admin | `/admin/(protected)/events` | `DELETE /api/admin/events/[id]` | `role=admin` | Admin removal uses the public-scope fallback (`apps/web/app/api/admin/events/[id]/route.ts:72`) | — | **Web-only** | web-only |
| Company search (directory) | "Where do you work?" picker (`apps/web/components/companies/AddCompanyModal.tsx`) | `GET /api/companies/search?q=` (`apps/web/app/api/companies/search/route.ts:14`) | Signed-in user; 60 searches/min per user (429) | Returns `{id,name,slug,logoUrl,domain,verified,memberCount}`; a hint (unproved `company_domains` row) shows as the known domain with `verified:false` and **never matches a domain search** (`supabase/migrations/20260929130000_company_directory_hints.sql` header) | None | JSON; the whole directory surface for mobile | **P2** |
| Company verification (work-email OTP) | AddCompanyModal 4-step flow (search → email → code → done) | `POST /api/companies/verifications` (start/resend), `POST /api/companies/verifications/confirm` (`apps/web/app/api/companies/verifications/route.ts:116`, `confirm/route.ts:74`) | Signed-in user; rate limits 5/h/user + 10/h/IP (start), 20/10 min (confirm) | Free/personal email domains refused; domain taken from the email; new company name must match the domain; 6-digit code, sha256+pepper stored, TTL 30 min, 5 attempts; success grants membership always, verifies the domain only when evidence ≥ medium (`verified_via` own_domain\|delegation\|mailbox_only); `domainVerified = verifiedVia !== "mailbox_only"` | None | Plain JSON; needs an email-client trip — flow must survive backgrounding | **P2** |
| Company page | `/dashboard/companies/[slug]` (`apps/web/app/dashboard/companies/[slug]/page.tsx`) | RPC `get_company_page` only; **no GET API route** | Any signed-in user | Name + "No longer active" badge; verified domains list with VerifiedMark; member count; "People here" list (verified members, avatar + name) + disclaimer "proves they control a mailbox — not that they represent the company"; empty state "Nobody has verified a work email here yet" | None | **No JSON endpoint** — mobile needs a GET route (or RPC wrapper) | **P3** |
| Leave company | Profile company card | `DELETE /api/companies/membership` (`apps/web/app/api/companies/membership/route.ts:14`) | Signed-in user | Deletes membership + clears the profile pointer; company/domains untouched for colleagues; `{removed:false}` is not an error | None | JSON | **P3** |
| Companies admin (+ featured) | `/admin/(protected)/companies` | `GET/POST /api/admin/companies`, `PATCH/DELETE /api/admin/companies/[id]`, `GET/POST /api/admin/companies/featured` | `role=admin` | Directory curation + featured ordering | — | **Web-only** | web-only |
| Join invite landing | `/join/[token]` (`apps/web/app/join/[token]/page.tsx`, `JoinCommunityClient.tsx`) | `GET /api/communities/join/[token]` (public, no auth), `POST /api/communities/join/[token]` (session) | GET anonymous; POST signed-in (401 → redirect to login) | Token = 32-hex `communities.invite_token`; public → immediate join (standing cap 7 applies, 429 at cap); private → idempotent join request (owner approves), cap counts pending too; statuses `joined`/`already_member`/`requested`; invalid 400, unknown/expired 404 | None | Deep-link target for mobile; POST outcome switches on `data.status` | **P2** |
| Job match notifications | (no page — notifications bell) | Emitted by `POST /api/jobs` via `deferJobMatchNotifications` (`apps/web/lib/jobs/notifications.ts:22`) | System (service role) | Fan-out to every `designer_profiles` row matching job_title + experience_level exactly and city/sector unless wildcard; poster excluded; unread dedupe on `(user_id, entity_type='job', entity_id)` | Notification row; no realtime room of its own | Mobile push pipeline exists (`MA/lib/push.ts`); the mobile notification settings only cover chat push today | **P2** |

---

## 1. Jobs browse — `/dashboard/jobs`

### 1.1 Route and gates

- RSC page: `apps/web/app/dashboard/jobs/page.tsx`. Requires session `role === "user"` else
  `redirect("/login")` (`:16-18`); no viewer row → `/login` (`:22-24`).
- First paint: `getJobFeed(db, viewer.id, { limit: JOB_FEED_PAGE_SIZE + 1 })` — the +1 row is the
  "cursor page exists" sentinel (`page.tsx:29-34`); the extra row is sliced off before rendering.
- `JOB_FEED_PAGE_SIZE = 50` (`apps/web/lib/jobs/service.ts:202`).

### 1.2 Tabs and list membership (`apps/web/components/jobs/JobsBrowser.tsx`)

| Tab | Membership predicate | Source |
|---|---|---|
| `# Hiring` | `!is_mine && !applied && kind === "hiring"` **then** `.filter(can_apply)` | `JobsBrowser.tsx:134,138` |
| `# Referral` | same with `kind === "referral"`, then `.filter(can_apply)` | `:135-139` |
| `Applied` | `!is_mine && applied` | `:140` |
| `My posts` | `is_mine` | `:127` |

Consequences (all intentional, per header comment `JobsBrowser.tsx:66-75`):
- A role the viewer's profile does not match never appears on the browse tabs ("Locked for your
  profile" cards are unreachable there; `can_apply` is the same predicate the DB write enforces).
- Own posts never appear in a browse tab; applied-to roles leave the browse tabs entirely.
- `My posts` is a plain list — selecting opens the posting's own page
  (`/dashboard/jobs/<id>`), not the master-detail pane (`:212-220`).
- `?job=<id>` seeds the initial tab + selection (`page.tsx:42`, `JobsBrowser.tsx:96-111`).
- Deep-link tab badges: `# Hiring` / `# Referral` show "N new" — roles posted after the newest
  posting instant the member last saw that tab, stored in `localStorage`
  `uxcommunity:jobs-seen:<viewerId>` keyed per kind (`:24-55,147-165`). Nothing is stored server-side;
  a fresh install counts everything as new.
- Below `lg` the panes take turns (rail → pane) with a back button; the tab strip hides while the
  pane is open (`:270,314,422-431`).

### 1.3 Search and filters

- One client-side search box, browse tabs only, shown when the pre-match list is non-empty
  (`JobsBrowser.tsx:318-336`). Matches `title`, `company.name`, `skills[]` case-insensitively
  (`:181-190`). Nothing is sent to the server; applied/My-posts tabs have no search.
- There is no server-side search, no kind/city/sector filter UI, and `/api/jobs/feed` accepts only
  the `before` cursor.

### 1.4 Cursor pagination

- `GET /api/jobs/feed?before=<created_at>|<id>` (`apps/web/app/api/jobs/feed/route.ts:18-49`).
  - Cursor format: the last row's `created_at` and `id`, joined by `|`; `+` in a UTC offset is
    normalised to `Z` before parsing (`:30-31`, `normalizeUtcCursor`).
  - Invalid cursor (unparseable date or non-UUID id) → `400 {error:"Invalid cursor."}` (`:32-34`).
  - Limit on the wire: `JOB_FEED_PAGE_SIZE + 1 = 51` (`:39`); `has_more` = the 51st row existed
    (`:40`). Missing cursor = first page — the mobile app can use this endpoint for its very first
    load.
  - The RPC clamps `p_limit` to `1..100` (`supabase/migrations/20261015120000_job_feed_cursor.sql:41`).
- Keyset order: `created_at desc, id desc`, strictly older than `(p_before_created_at, p_before_id)`
  (`job_feed_cursor.sql:38-40`).
- Feed membership rule (server side): `job_post_is_open(status, closes_at) OR jp.poster_id = viewer`
  (`job_feed_cursor.sql:36-37`). So closed/expired postings are **only readable by their owner**; a
  member's applied-to closed posting disappears from their feed (the Applied tab is a client
  filter over loaded pages, so a closed applied job vanishes on the next load).
- Client merge dedupes by id and appends in order (`JobsBrowser.tsx:223-244`); network failure leaves
  the board unchanged (no error UI).

### 1.5 Job card contents (`apps/web/components/jobs/JobCard.tsx`)

Left→right, top→bottom: company logo (stored image → domain favicon → initial,
`apps/web/components/companies/CompanyBadge.tsx:17-55`); title (accent, truncate) + experience years
in parentheses carved out of the label (`experienceYearsLabel`, `apps/web/lib/jobs/format.ts:147-150`);
right cluster: `JobStateBadge` (Closed wins over Expired — `JobBadges.tsx:61-69`), `KindBadge`
(`#Hiring` amber / `#Referral` indigo, `JobBadges.tsx:20-30`), owner menu on My posts; meta line:
`company • city_name (work mode) • salary?`; footer: `posted_label · updated_label? ·
deadline_label?` (deadline amber when expired), right side one of: `N applicants` (mine) / `Applied`
(emerald check) / `You match this role` / `Locked for your profile`.

Label rules:
- `timeAgoLabel` — "Just now", `Nm ago`, `Nh ago`, "Yesterday", `Nd ago`, else `MMM D` in UTC
  (`format.ts:8-24`).
- `editedLabel` — "Updated …" only when `updated_at` is set and strictly after `created_at`
  (`format.ts:34-43`).
- `jobDeadline` — "Closes MMM D" / "Expired MMM D", suppressed entirely when `status = "closed"`
  (`format.ts:79-106`); `deadline_expired` computed from the same instant (`:112-121`).

### 1.6 Eligibility rule (authoritative SQL)

- The apply gate: `apply_to_job` compares the applicant's **own profile row** (never request fields):
  `(job.city_id is null or dp.city_id = job.city_id) AND (job.sector_id is null or dp.sector_id =
  job.sector_id) AND dp.job_title = job.job_title AND dp.experience_level = job.experience_level`
  (`supabase/migrations/20261010130000_job_wildcard_criteria.sql:472-481`).
- `can_apply` in the payload uses the identical expression plus `job_post_is_open(...)`,
  `viewer <> poster`, and no existing application (`:602-618`).
- NULL city/sector = "All" wildcard written by `create_job_post` / `update_job_post`
  (`:138-152`, `:296-308`); the payload resolves display labels `'All cities'` / `'All sectors'`
  (`:539-541`).
- Client mirror for copy only: `criteriaMismatches` (`apps/web/lib/jobs/types.ts:209-217`).

### 1.7 Notifications badge / own-post edge cases

- Own post: Apply never offered; detail shows "View N applicants" (`JobDetail.tsx:123-131`).
- Applied + still open: no action row at all — the Application status card carries everything
  (`JobDetail.tsx:118-121`).
- Applied + closed/expired: action row replaced by "This posting is closed/expired" + "Your
  application was submitted <when>" (`JobDetail.tsx:132-154,434-438`).

---

## 2. Job detail — `/dashboard/jobs/[jobId]`

### 2.1 Page

`apps/web/app/dashboard/jobs/[jobId]/page.tsx` — session gate `:20-23`; viewer gate `:27-30`; job read
via RPC `get_job_detail` (`apps/web/lib/jobs/service.ts:229-245`); missing → `notFound()` (`:33-35`).
Master data (cities/sectors/job titles/experience levels, active-only) is loaded **only for the
owner** (`:40`) because only the owner's edit form needs it.

### 2.2 Payload fields (RPC `job_post_payload`, final definition in the wildcard migration)

`id, kind, title, description, responsibilities[], requirements[], skills[], salary, website,
work_mode, employment_type, city_id, city_name, sector_id, sector_name, job_title,
job_title_label, experience_level, experience_level_label, created_at, status, updated_at,
closes_at, company{id,name,slug,logo_url,domain,domain_verified}, poster{id,name,avatar_url,
job_title,job_title_label,experience_level,experience_level_label,company_name}, applicant_count,
criteria_locked, applied, is_mine, can_apply, my_application{id,name,portfolio_url,linkedin_url,
resume_url,created_at}` — `supabase/migrations/20261010130000_job_wildcard_criteria.sql:524-645`
(`company.logo_url` is passed through `companyLogoUrl` server-side, `apps/web/lib/jobs/service.ts:180-191`).

### 2.3 Rules visible on the page

- Eligibility badge: `can_apply` → "Apply now" + "Your profile matches this role"; otherwise the
  lock names the gating dimensions and the mismatching ones (`JobDetail.tsx:155-175`).
  The eligibility badge is computed server-side; the UI never derives it.
- Lifecycle: `Closed` badge / "This posting is closed — it is no longer accepting applications";
  `Expired` badge / "Its closing date has passed…" (same component tree, `JobBadges.tsx:33-69`).
- Company cell shows `VerifiedMark` only when `company.domain_verified` (`JobDetail.tsx:85-88`).
- About sections render only non-empty arrays; description through `RichText`
  (`JobDetail.tsx:240-305`).
- Poster card: "Referred by" for referral, "Posted by" otherwise; "You" when `is_mine`
  (`JobDetail.tsx:210-238`).
- `applyOpen` modal only mounted for `!is_mine && !applied && can_apply`
  (`JobDetail.tsx:307-315`).
- **No share and no report for jobs** (grep of `components/jobs/` — no `navigator.share`, no
  `ReportModal`; reports exist for threads/showcase/resources/events only).

### 2.4 Apply flow — what is submitted

`POST /api/jobs/[id]/apply` (`apps/web/app/api/jobs/[id]/apply/route.ts`):

1. `requireSession("user")` (`:42-47`); non-multipart content type → `415` (`:49-52`); unreadable
   FormData → `400` (`:54-59`).
2. Zod `jobApplicationSchema` — `name` 2–120 trimmed; `portfolio_url` valid URL + `http(s)://`;
   `linkedin_url` valid URL + `http(s)://` + contains `linkedin.com`
   (`apps/web/lib/jobs/validation.ts:12-25`); failure → `422 {error:"Validation failed", issues}`
   (`:61-71`).
3. Resume required: either a file Blob with size > 0 or `saved_resume_id` (`:79-90`) else
   `422 {error:"resume_required", message:"Attach a resume to apply."}`.
4. Fresh upload path: >5 MB → `413`; magic-byte MIME detection over PDF/DOC/DOCX/RTF else
   `422 "Attach a PDF, DOC, DOCX or RTF resume."` (`apps/web/lib/jobs/resume-file.ts`); R2 key
   `resumes/<userId>/<ts>-<rand>.<ext>` (`:113`); upload failure → `500`.
5. Saved-resume path: UUID shape check, then `member_resumes` read **scoped to the session user**
   (`:126-151`); a foreign or deleted id fails the same as a missing one
   (`422 invalid_resume_url`).
6. `apply_to_job` RPC (see §1.6 plus resume URL check `^https?://`, unique constraint
   `job_applications_job_applicant_key`).
7. Failure → uploaded object deleted from R2 (`:163-171`), then mapped response
   (`STATUS_FOR_FAILURE`, `:9-23`): `job_not_found 404`, `unknown_user 401`, `own_job 409`,
   `job_closed 409`, `job_expired 409`, `invalid_* 422`, `not_eligible 403`, `already_applied 409`,
   `not_installed 503`, `unexpected 500`; messages in `MESSAGE_FOR_FAILURE` (`:25-34`).
8. Success: `{application_id}` (`:213`). First-upload adoption: if the member had **zero**
   `member_resumes`, the just-uploaded file is inserted there with `is_default: true`; non-fatal
   (`:187-211`).

Profile fields are **not** submitted beyond name/portfolio/linkedin prefill — the app sends only the
three text fields + resume reference; eligibility is read from the profile row inside the RPC.

### 2.5 Already-applied state

- `applied` + `my_application` in the payload; the page shows an "Application status" card with a
  static "Application submitted" state and "View application" reopening the exact submitted fields
  (`JobDetail.tsx:181-207,335-431`). There is **no viewed/accepted/rejected feedback loop to the
  applicant** — poster triage is invisible to them (only the poster sees statuses).

---

## 3. Job creation, my posts, applicants

### 3.1 Post a job — `POST /api/jobs`

- Route: `apps/web/app/api/jobs/route.ts:36-97`. Body is JSON; schema
  `jobPostSchema` (`apps/web/lib/jobs/validation.ts:31-100`):
  - `kind: "hiring"|"referral"`, `company_id: uuid`, `title` 2–140 trimmed,
    `city_id: uuid|null`, `sector_id: uuid|null` (null = All), `job_title` ≥1, `experience_level` ≥1,
    `work_mode: remote|hybrid|onsite`, `employment_type: full_time|part_time|contract|internship`,
    `salary` ≤80 optional, `description` rich-text: raw ≤2×RICH_TEXT_MAX_HTML_CHARS, trimmed +
    sanitised, plain text ≤RICH_TEXT_MAX_CHARS (8000), html ≤RICH_TEXT_MAX_HTML_CHARS,
    `responsibilities`/`requirements`/`skills` ≤20 lines each, `website` optional http(s) ≤300,
    `closes_at` plain date required-present field ""→null, else end-of-day UTC with round-trip
    validation rejecting rolled dates (`apps/web/lib/jobs/format.ts:53-67`).
  - Failure → `422 {error:"Validation failed", issues}`.
- Write goes through `create_job_post` (final definition `job_wildcard_criteria.sql:55-206`) which
  re-checks: user exists, kind, title, description non-empty, work mode, employment type, company
  active, **poster's `company_members.verified`**, active city/sector when named, active job title /
  experience level, website prefix; lists normalised (trim, drop blanks, cap 20; 200/200/60 chars).
- DB failure codes → HTTP (`apps/web/app/api/jobs/route.ts:8-25`): `company_not_verified 409`
  ("A job can only be posted for a company you have verified with a work email."),
  `company_inactive 409`, `monthly_limit_reached 429` (raised as `limit:jobs_monthly` by the trigger
  `enforce_job_creation_limit`, `supabase/migrations/20261013120000_creation_limits.sql:217-232`),
  `not_installed 503`, rest 422/500/401.
- Creation budget: **1 job per member per UTC calendar month**, counted by an append-only counter —
  deleting a job does **not** refund it (`creation_limits.sql:8-9,32-34,807-816`).
- Success: `{job_id}` + deferred best-effort `job_match` notification fan-out
  (`apps/web/app/api/jobs/route.ts:94`; details §8).
- Form surface: `apps/web/components/jobs/PostJobForm.tsx` — kind cards + verified-company block
  (in-flow `AddCompanyModal` allowed) + three field cards; client pre-checks mirror the schema
  (`PostJobForm.tsx:60-83`); payload builder `jobFormPayload` sends `city_id/sector_id = null` for
  the All choices (`apps/web/components/jobs/JobFormFields.tsx:306-324`).

### 3.2 My posts / edit / close / delete

Owner menu `apps/web/components/jobs/JobOwnerActions.tsx` — Edit (labeled "Change deadline" when
`deadline_expired`), Close/Reopen, Delete (confirm dialog naming the applicant count).

- `POST /api/jobs/[id]/edit` (`apps/web/app/api/jobs/[id]/edit/route.ts:42`): body
  `jobPostUpdateSchema` = post schema minus `kind`/`company_id` (`validation.ts:113`) — those two are
  immutable by design (`edit/route.ts:7-15`). `update_job_post` re-checks owner; if any application
  exists, any change to `city_id/sector_id/job_title/experience_level` (including null↔value) raises
  `criteria_locked` → `409` (`job_wildcard_criteria.sql:265-276`); `closes_at` is **not** frozen
  (`:366-396`); `responsibilities/requirements/skills` absent (null) keep the stored list;
  `updated_at` only moves when the row comparison detects a real change, and the response returns
  the stored `edited_at` (`service.ts:514-553`).
- `POST /api/jobs/[id]/status` `{status:"open"|"closed"}` (`status/route.ts:27`): sets the owner
  lever; reopening clears a `closes_at` that has already passed
  (`supabase/migrations/20261009180000_job_expiry.sql:464-470`). Closed keeps URL/list/applicants;
  the row is only visible to its owner in the feed.
- `DELETE /api/jobs/[id]` (`apps/web/app/api/jobs/[id]/route.ts:26`): permanent; applications cascade;
  resume R2 objects are deliberately left for the orphan audit (`service.ts:589-593`).

### 3.3 Applicants view — owner-only

- Page `/dashboard/jobs/[jobId]/applicants`: non-owner → redirect to the posting
  (`applicants/page.tsx:31-33`); the SQL RPC itself raises `not_your_job` for anyone else
  (`supabase/migrations/20261010120000_job_application_triage.sql:104-109`).
- Each row: avatar, name (links to profile), `Applied <label>`, Portfolio / LinkedIn / Resume links,
  Profile button, triage cluster + counts tabs All/New/Shortlisted/Rejected
  (`ApplicantsBoard.tsx:209-320`).
- Enrichment adds `role_label` (seniority + designation via the profile helper) and `city_name`
  (`service.ts:293-333`) — these are NOT in the SQL payload.
- The design-mode card links to `/applications/<jobId>/<applicantId>?` — actually
  `/applications/<jobId>/<firstVisibleApplicationId>` (fresh tab), absent when there are no
  applications (`designModeHref`, `apps/web/lib/jobs/design-href.ts:11-18`).

### 3.4 Application triage statuses

- States: `new | shortlisted | rejected` (`apps/web/lib/jobs/types.ts:31-34`), default `new`.
- Write: `POST /api/jobs/[id]/applications/[applicationId]/status` `{status}`
  (`status/route.ts:31-73`) → `set_job_application_status` which re-checks ownership through the
  application's own job in the same statement (`20261010120000_job_application_triage.sql:63-85`);
  refusals `application_not_found 404`, `not_your_job 403`, `invalid_status 422`.
- Free movement in any direction; no decision timestamp; the response carries the stored status
  (`service.ts:340-372`). UI adds an undo toast whose undo is the opposite write
  (`use-applicant-decision.ts:32-77`).

### 3.5 Design-mode viewer (web-only; underlying data)

- Route `/applications/[jobId]/[applicationId]` deliberately outside `/dashboard`
  (`page.tsx:16-25`); owner-only (redirect `:48-50`); application id must still exist among the
  job's applicants else redirect (`:69-71`).
- Data = the same `get_job_applicants` list + `loadJobApplicantDetails` (profile facts) +
  `member_resumes`/R2 resume URL. There is no viewer-specific API.
- Rendering/UX specifics (all web-only): sidebar 280 px, left; chosen link in an iframe; resume PDFs
  in the repo's own pdf.js viewer (`ResumePdf`); LinkedIn pane refuses framing with an outbound link;
  forced dark palette (`.design-dark`); prev/next + Esc/arrows; triage buttons in the sidebar
  (`apps/web/components/jobs/DesignModeViewer.tsx:47-130`).

### 3.6 Jobs admin (web-only)

`/admin/(protected)/jobs`; `GET /api/admin/jobs` (filters `all|open|closed|expired`, page 25,
`apps/web/app/api/admin/jobs/route.ts:6-29`) and `DELETE /api/admin/jobs/[id]` (`:23`). Requires
`role=admin`. Out of scope for mobile.

---

## 4. Events browse — city Events page (`/dashboard/events`)

### 4.1 Page and viewer city

- `apps/web/app/dashboard/events/page.tsx`: session gate `:16-17`; viewer city resolved from the
  profile (`loadCityEventViewer`, `apps/web/lib/events/service.ts:38-55`); both phases fetched in one
  round trip (`:31-34`); a DB failure renders `loadFailed` rather than a fake empty city (`:39-44`).
- No city on the profile → `viewer = null` → empty state "No city on your profile yet" with a button
  to the profile (`CityEventsView.tsx:257-269`); the API returns `422 {"error":"No city on your
  profile."}` (`apps/web/app/api/events/city/route.ts:23-26`).

### 4.2 Listing SQL (authoritative filters)

`get_city_event_list_page` (`supabase/migrations/20261010150000_city_event_filters.sql:30-111`):

- `is_public AND city_id = p_city_id` — no membership gate; hard requirement
  (`:57-58`).
- `p_is_online` null/t/f — type filter (`:59`).
- Start-date window on `event_date` (inclusive `from`, exclusive `to`, `:60-61`).
- Phase over `coalesce(end_date, event_date)` vs `p_now`: upcoming `>= now` asc; past `< now` desc
  (`:62-67`).
- Keyset cursor `(event_date, id)` with direction per phase (`:69-72`); limit clamped `1..26`
  (`:73`).
- Projection adds host `users{name,avatar_url}`, `community_name`, `community_image` (master-data
  image for official groups), counts (`rsvp_count`, `like_count`, `save_count`) and viewer flags
  (`user_rsvped`, `user_liked`, `user_saved`) (`:75-98`).

### 4.3 API

`GET /api/events/city` (`apps/web/app/api/events/city/route.ts`):

- Cursor `cursor=<phase>|<event_date>|<id>`; first segment must be `upcoming|past` else `400`
  (`:29-32`); date normalised (`+`→`Z`) and parse-checked (`:33-43`).
- `type` must be `online|in-person` when present else `400` (`:49-52`); `from`/`to` parse-checked
  (`:55-68`).
- Page size `CITY_EVENT_PAGE_SIZE = 25` with +1 sentinel (`apps/web/lib/events/service.ts:18,92`);
  `nextCursor` is `null` when the phase is exhausted, and the string `"past"` when the *upcoming*
  phase ends (the client turns that into "Past tab complete", `service.ts:106-111`).
- Errors: `500 {"error":"Failed to fetch events."}` on RPC failure.

### 4.4 Filter row (event-filters)

- Type: All / Online / In person; Date: Any date / Today / This week (Mon-start) / This month
  (`apps/web/components/events/event-filters.ts:12-26`).
- Windows computed **from the viewer's own clock** and sent as absolute instants
  (`dateWindow`, `:29-57`); the API/DB only compare (`:5-9`). A window filter applies to
  event **start**.
- Filter changes refetch both phases from scratch and replace cursors (never mix filter sets,
  `CityEventsView.tsx:79-113`); the filter menu is a single trigger with the two dimensions
  (`EventFiltersMenu`).
- Split Upcoming/Past re-evaluates on a 30 s tick (`EVENTS_SPLIT_TICK_MS`, `CityEventsView.tsx:24`);
  past cards render at 60 % opacity (`:303`).
- The city page has **no create button** ("events belong to a community and are created from it",
  `CityEventsView.tsx:32-37`) and **no realtime room** (`:36`).
- Cards are the same `EventCard` used everywhere + the shared `EventChatPanel` row
  (`CityEventsView.tsx:300-336`).

---

## 5. Event detail — `/dashboard/events/[eventId]`

### 5.1 Access

- Session gate (`page.tsx:11-12`); event row loaded directly from `community_events`
  (`:18-22`) with the shared `EVENT_CARD_COLUMNS` list
  (`apps/web/lib/communities/event-cards.ts:16-17`); missing → redirect `/dashboard` (`:24`).
- **Not a member of the event's community AND event not public → redirect to the community page**
  (`:45`). Public events are readable by every signed-in member (read-only view); the join-chat
  panel already hides itself when the viewer may not join.

### 5.2 What the card renders (`apps/web/components/communities/events/EventCard.tsx`)

- Ticket layout (web design): poster panel (cover or gradient; location caption), body (title h1 in
  detail variant `:600-604`), stacked rows: date `fmtEventDate` in `en-IN` (`:124-126,609-612`), time
  range on the **viewer's clock** with the zone in the `title` tooltip
  (`formatEventTimeRange` + `eventZoneTooltip`, `apps/web/lib/communities/event-display.ts:24-59`),
  an extra "Host time: … (zone)" row only when the host's clock differs from the viewer's
  (`hostScheduleForViewer`, `:93-127`), Online (meet link → "Online (Google Meet)" link) vs location
  row, `N spots remaining` / "No spots remaining" when `max_attendees` set (`:648-655`);
- Going strip: avatar stack (max 5) + "N people going" (`AvatarStack`, `:160-211`).
- Stub: big date block (weekday/day/month/year in en-IN) + RSVP button — `I'm Going` /
  `Going ✓` / `Event Full` (disabled when `max_attendees !== null && rsvp_count >= max` and not
  rsvped) / "This event has ended" when past (`:456,484-501`).
- Title, description (collapsed 2-line clamp with "Read more" in list variant; full in detail),
  like count + comment count, community attribution (`:776-853`).
- Options menu (`EventOptionsMenu`): Save, Share, Copy link, Edit (owner), Delete (owner **or**
  moderator `canModerate`), Report (`:757-773`).
- Share: `navigator.share` if available, else clipboard + "copied" state (`:442-454`).
- Discussion: comments load via `GET /api/communities/[id]/events/[eventId]/comments` with a 15 s
  stale cache (`EventDetailClient.tsx:72-110`); "event not found" redirects to the community
  (`:94-98`).
- Join questions dialogs: RSVP confirm dialog names the room side-effect; join → host's questions →
  request (`EventCard.tsx:875-910`).

### 5.3 RSVP (Join / Withdraw)

`POST /api/communities/[id]/events/[eventId]/rsvp` (`rsvp/route.ts`):

- Scope addressing: `communityId === "public"` matches `is_public = true AND community_id IS NULL`;
  otherwise the event is looked up under that community (`:39-46`). Wrong scope → `404`.
  Nuance: `community_events.community_id` is NOT NULL again since
  `supabase/migrations/20260830100000_remove_standalone_public_posts.sql:11-19` (standalone public
  rows were deleted), so the `"public"` branch matches no current row — it is a defensive/legacy
  path. Mobile should always send the real `community_id` from the card payload.
- If an RSVP row exists → **withdraw**: delete row; leave the event's group chat (owner never
  removed, `event-chat.ts:298-316`); publish `rsvp DELETE`; home feed tag revalidated; response
  `{rsvped:false, rsvp_count, chat_community_id}` (`:50-93`).
- Else capacity check against `max_attendees` → `409 {"error":"This event is full."}` (`:95-101`).
- Insert failure surfaces as `500` (deliberate — historically a silent failure flipped the UI,
  `:103-110`).
- Join also: `canJoinEventChat` (public event → anybody; else the event's community members,
  `event-chat-rules.ts:83-88`) → find-or-create the room → join → store the join answers when the
  payload carried complete ones (`:112-144`). **The web app always sends answers; a client that
  RSVPs without them is legal** (comment at `:132-137` — explicitly names the mobile app's one-tap
  RSVP), and an incomplete payload simply stores nothing.
- Response `{rsvped:true, rsvp_count, chat_community_id}`; notification `event_rsvp` to the host
  (`:153-163`); publish `rsvp INSERT` (`:150-152`).
- Host auto-RSVP: written at creation (`apps/web/app/api/communities/[id]/events/route.ts:244-249`);
  backfilled for old events (`supabase/migrations/20261008120000_event_host_is_going.sql:57-66`).
- Join answers: two compulsory free-text questions (`why_attend`, `expectations`), each ≤ 2000
  chars; `joinAnswersPayload` returns null when incomplete
  (`apps/web/lib/communities/event-join-questions.ts:13-79`). `POST .../chat` **requires** them
  (`400` otherwise, `chat/route.ts:43-49`); the RSVP route treats them as optional.

### 5.4 Attendance / capacity model

- Attendance = `event_rsvps` rows (`(event_id, user_id)` PK) — RSVP is the only attendance signal;
  there is no check-in.
- Capacity enforced only at RSVP time (route check above); already-rsvped users can stay past the cap.
- Attendee previews: `get_event_attendee_previews` limit 5 for cards (`event-cards.ts:36-50`); full
  list (oldest first) for detail pages (`loadEventRsvps`, `:57-84`); `GET .../rsvp/list` for the
  client refresh after a change.

### 5.5 Timezone rules

- Writing: the form converts wall-clock inputs to an offset-suffixed ISO in the **viewer's own
  zone** (or an explicitly chosen one) (`localInputToIso`, `apps/web/lib/communities/event-time.ts:78-124`);
  the API **refuses zone-less timestamps** (`requireZoneAwareIso`, `:337-346`) — this fixed a real
  bug where naive values were read as UTC (`:1-13` in the same file, and the migration
  `20260925120000_fix_naive_event_timestamps.sql`).
- Reading: every surface renders in the **viewer's** zone; the zone is never a UI field — it is the
  hover title on the time (`eventZoneTooltip`) and the "Host time" line when it differs.
- `host_timezone` (IANA, validated resolvable, ≤64 chars, `validTimeZone` `:355-365`) +
  `host_utc_offset_minutes` (integer within ±840, `validOffsetMinutes` `:368-372`) are best-effort
  metadata stored on the event; unusable names drop to null rather than failing the write.
  On PATCH they are only rewritten when the start actually moved (≥ 60 s,
  `[eventId]/route.ts:96-111`).
- Past-start guard: 60 s grace (`PAST_START_GRACE_MS`, `event-time.ts:147`); `isPastStart` refuses
  even an unparseable value (fail closed, `:312-315`). PATCH does not re-run the past guard — an
  untouched past start can still be edited for other fields (`startMovedByEdit`, `:317-329`).

### 5.6 Ended / upcoming / live

- `hasEventEnded(start, end)`: past when `now >= (end ?? start)` (`apps/web/lib/communities/event-date.ts:74-84`).
  The Join-chat row disappears at that instant (`EventChatPanel.tsx:106-108`), and the chat route
  backs it up with `400 "This event has ended."` (`chat/route.ts:77-79`).
- Badge (`eventDateBadge`, `event-date.ts:117-156`): TODAY on the viewer's calendar day, LIVE while
  `start <= now < end`, ENDED for `EVENT_ENDED_GRACE_MS = 12 h` after the end (`:23,149-153`), then
  tile dropped.
- The `get_city_event_list_page` phase boundary uses the same `coalesce(end_date, event_date)`
  expression, so the badge and the list agree.

---

## 6. Event room — `/dashboard/communities/[id]` for `type = 'event'`

### 6.1 Model

- An event room is an ordinary community with `type='event'` and `communities.event_id` pointing at
  the event; `communities` is the single source the chat/realtime/sidebar ecosystem reads
  (`apps/web/lib/communities/event-chat.ts:16-22`).
- `ensureEventChatCommunity` (find-or-create, idempotent on the partial unique index): name =
  event title capped 80 (fallback "Event chat"), description constant, `reference_id: null`,
  image = cover, owner = creator, **`is_private: false` always**, `enabled_tabs:["chat"]`,
  showcase off, `is_active: true` (`event-chat.ts:58-114`; rules `event-chat-rules.ts:16-37`).
- Creator joins as `role:"owner"` at creation; everyone else joins by confirming they are going
  (RSVP route) or through the explicit chat-join route.

### 6.2 Room privacy vs "Share publicly" — the documented divergence

- The event's `is_public` flag ("Share publicly" toggle, `CreateEventModal.tsx:494-502`) decides
  home-feed visibility and whether non-members may read the detail page; the room is created
  `is_private:false` regardless.
- Room badges read the **room's** `is_private` (`communityNameBadges(community.type, community.is_private)`,
  see `JoinCommunityClient.tsx:71-76`), so an event room's badge always reads "Public community"
  even when its event is not shared publicly. The two flags genuinely diverge — the memory's note
  is confirmed in code: there is no code path that copies `is_public` onto `communities.is_private`.
- Who may join the room: `is_public || parentCommunityMember` (`event-chat-rules.ts:78-88`), i.e. a
  private (non-shared) event's room is still joinable by every member of its community.

### 6.3 Join / Open behavior

- Event detail: `EventChatPanel` — one row before the event ends; "Join" (confirm modal → host's
  questions) or "Open" (already joined) (`EventChatPanel.tsx:31-212`); roomless events create the
  room on first join via `POST .../chat`.
- Room page itself: `EventChatJoinGate` handles viewers who are not members (confirm-to-join gate,
  membership follows the same rule).
- Info card: `EventRoomSection` (right sidebar) fetches `GET /api/communities/[id]/event`
  (member-only, `403` for non-members; `404` when the community is not an event's room,
  `event/route.ts:20-33`) and draws the event ticket, the going preview (24 rows max,
  `GOING_PREVIEW_LIMIT`, `event-chat.ts:342`) and the door back to the event page.
- "Carry-on" (owner-only, web design): after `hasEventEndedBeyondGrace` (end + 12 h) and only while
  the room still wears the event's name/face/description and only has the chat tab
  (`roomStillWearsEvent`, `roomStillOnlyChat`, `carryOn` computation `event-chat.ts:403-408`;
  section render `EventRoomSection.tsx:272-301`), the room's owner is offered "After the event" to
  repurpose the room via community settings (`RoomCarryOnCard`, `:126-176`). Any first personal
  edit retires the offer, and from then on event edits stop syncing to the room
  (`syncEventChatCommunity`, `event-chat.ts:131-158`).
- Chat watermark (web design only): the event title drawn at 8 % opacity behind messages
  (`apps/web/components/communities/chat/ChatWatermark.tsx:1-25`), rendered only while the event is
  still the room's news.
- Room lifetime: deleting the event **keeps the room** (only the `event_id` link and badges go);
  the delete response returns `chat_community_id` so the client can drop caches
  (`[eventId]/route.ts:266-308`; migration `20260925140000_event_delete_keeps_group_chat.sql`).

---

## 7. Event creation / edit — who can create

- Creation surface: community Events tab (`EventsView` → `CreateEventModal`); **any member of the
  community** may create; the route enforces membership (`POST` gate
  `events/route.ts:124-126`) and the DB trigger enforces 1 event per member per UTC month
  (`creation_limits.sql:200-215,332-335`), returning `429` with `CREATION_LIMIT_MESSAGES` copy
  (`events/route.ts:229-235`).
- Required fields (route-level): title `1..120`; `event_date` zone-aware ISO required, not past
  (60 s grace); `end_date` after start; `city_id` required UUID (`:191-200`). Optional: description
  ≤ 5000, `is_online`, `location` ≤ 500, `meet_link` valid http(s) URL, `max_attendees` > 0 floored,
  `cover_image_url`, `accent_color #RRGGBB`, `is_public`, `host_timezone`/`host_utc_offset_minutes`.
- The **web form** is stricter than the API: description required, cover image required, and the
  cover is uploaded first via `POST /api/communities/[id]/events/upload` (JPEG/PNG/WebP/GIF/AVIF,
  ≤ 5 MB, GIF passes through uncompressed) (`CreateEventModal.tsx:100-128,139-161`);
  "poster-left" 2-column layout and the city picker only shown when public (`:249-280,506-525`) —
  all web-only. The API still requires `city_id` for every event, public or not (comment
  `events/route.ts:191-193`).
- On create: host RSVP inserted (non-fatal), pubsub `event` + chat `content-insert`
  "created an event" card, room created, response `201 {event, chat_community_id}` (`:244-291`).
- Edit (`PATCH`): owner only (`403 "Not the event owner."` when not, `:77`); partial body; the same
  field validations minus the past-start guard; "Nothing to update." `422` on an empty patch
  (`:158`); room name/cover follow and old cover R2 objects are reclaimed
  (`:169-211`); response `{event}`.
- Delete (`DELETE`): owner, or a manager with `can_moderate_events` (non-public scope only)
  (`:251-264`); moderated deletions write a `community_activities` row + `event_deleted` notice
  (`:283-304`); response `{ok:true, chat_community_id}`.

---

## 8. Companies — directory, verification, page

### 8.1 Where the "directory" is

There is **no `/dashboard/companies` list page** — the only company routes are
`/dashboard/companies/[slug]` (detail) plus the picker inside `AddCompanyModal`. The searchable
directory is `GET /api/companies/search` (used by the picker and referenced by the jobs company
block).

- `GET /api/companies/search?q=<query>` (`apps/web/app/api/companies/search/route.ts:14-34`):
  session required (`verifyActive:false`), rate limit 60/min per user → `429`; delegates to
  `search_companies` RPC (`apps/web/lib/companies/service.ts:220-244`); response
  `{companies:[{id,name,slug,logoUrl,domain,verified,memberCount}]}` (empty query = browse).
- Hint semantics (migration header `20260929130000_company_directory_hints.sql`): a directory hint
  (`company_domains.verified=false`) is reported as the company's known domain with `verified:false`,
  and a hint **never matches a domain search** — routing a work email to a company never follows a
  hint. The hint counts only as a starting point to prove.

### 8.2 Company page — what a member sees

`apps/web/app/dashboard/companies/[slug]/page.tsx` (session gate `:29-30`; `getCompanyPage` RPC via
`service.ts:493-530`; missing → 404):

- `logoUrl` = stored `companies.logo_url`, else the domain's icon, else initial
  (`companyLogoUrl`, `apps/web/lib/companies/logos.ts:39-53`; favicon service = Google s2 favicons
  at 128 px; free-email domains deliberately get `null` so a Gmail icon never decorates a company,
  `:39-43`).
- Verified-eleven: badges `No longer active` when `is_active=false` (`page.tsx:66-70`); the list of
  verified domains each with `VerifiedMark` (`:73-82`); member count (`:84-87`); "People here" list
  of verified members (name + avatar + verified mark) with the disclaimer that verification proves
  mailbox control, not representation (`:102-132`); empty state "Nobody has verified a work email
  here yet." (`:122-124`).
- Deliberately not shown: member work emails, "official representative" claims (page header
  `:19-27`).

### 8.3 Verification flow (work email OTP → domain verification)

Four-step picker (`AddCompanyModal.tsx`): search/select an existing company (or type a new name) →
enter work email → enter 6-digit code → done.

Start/resend — `POST /api/companies/verifications` (`verifications/route.ts`):

- Body (`startSchema`, `:40-50`): `{company_id?: uuid|null, company_name?: string(1..120)|null,
  work_email?: string(3..254), verification_id?: uuid}` — either a work email or a
  `verification_id` (resend; server reads the address back from the member's own challenge so a
  client cannot aim a code at an address it did not start, `:33-38,162-178`).
- Rate limits: 5/h/user + 10/h/IP → `429 {"error":"rate_limited"}` (`:130-139`).
- `checkWorkEmail` refuses malformed addresses (`invalid_email 422`) and free/personal providers
  (`personal_email 422`, list in `apps/web/lib/companies/domains.ts:29-78`).
- New (unnamed) company: the name must match the domain being proved
  (`companyNameMatchesDomain`), else `422 company_name_domain_mismatch` with a `suggested_name`
  (`:198-221`).
- DB refusals (`start_company_verification`) → `STATUS_FOR_FAILURE` (`:52-65`):
  `invalid_work_email 422`, `invalid_domain 422`, `email_domain_mismatch 422`,
  `company_name_required 422`, `company_inactive 410`, `company_name_taken 409`,
  `domain_not_verified_for_company 409`, `domain_already_verified 409`, `already_member 409`,
  `unknown_user 401`, `not_installed 503`. `domain_already_verified` distinguishes a verified claim
  from a reserved (hint) domain in its copy (`failureMessage` `:75-114`) and returns
  `company:{id,name}` so the UI can offer "Join X instead".
- Email send failure → `502 {"error":"email_failed"}` (challenge stays open; a resend reuses it).
- Success: `{pending:{id, companyId, companyName, domain, maskedEmail, attemptsLeft:5, expiresAt}}`
  — the raw work email never leaves the server (`:279-281`).
- Code: 6 digits from the CSPRNG, `sha256(pepper + code)` stored; TTL 30 min
  (`VERIFICATION_CODE_TTL_MINUTES`, `apps/web/lib/companies/codes.ts:14-17`); 5 guesses per challenge
  (`:16-17`; DB counter `20260929120000_company_verified_domains.sql:717-745`); expiry checked
  before compare (`:717`).

Confirm — `POST /api/companies/verifications/confirm` (`confirm/route.ts`):

- Body `{verification_id: uuid, code: 6 digits}`; malformed → `422 invalid_code` (`:99-109`);
  rate limit 20/10 min per user (`:84-90`).
- DB statuses → `STATUS_FOR_CONFIRM` (`:31-42`): `invalid_code 422` (with `attemptsLeft`),
  `not_found 404`, `already_used 409`, `expired 410`, `too_many_attempts 429`,
  `company_inactive 410`, `domain_not_verified 409`, `domain_already_verified 409`,
  `not_installed 503`.
- `domain_already_verified` race: re-reads the domain from the member's own pending challenge
  (never the body) and names the company to join (`:122-140`).
- Success `{company:{id,name,slug,logoUrl,domain,joinedAt,domainVerified,verifiedVia}}`
  (`service.ts:447-461`).
- **The trust model in one line** (`docs/company-email-domain-resolution.md:9-40`): a correct code
  always grants the membership; it promotes the domain claim to `verified` only when the claim's
  evidence is `high`/`medium` — otherwise the membership is real but
  `verified_via='mailbox_only'` and `domainVerified=false` (member joined; domain question
  queued for review). `verified_via` ∈ `own_domain | delegation | mailbox_only`
  (`service.ts:151`).
- Member states seen by the UI: `pending` (challenge live, `get_pending_company_verification`
  returns only a live challenge — consumed/expired returns nothing, migration `:396-435`),
  `verifiedVia=mailbox_only` (member, no verified badge), `verified` (member + domain badge).

### 8.4 Membership lifecycle & profile interplay

- `getProfileCompanyState` (`service.ts:246-291`) → profile company card:
  `{companyId,name,slug,logoUrl,isActive,domain,domainVerified,membershipVerified,joinedAt}` +
  `pending` challenge.
- Leave: `DELETE /api/companies/membership` (`membership/route.ts:14-32`) → `leave_company` RPC;
  `{removed:true|false}`; company and domains untouched (`service.ts:464-482`).
- Jobs interplay: `loadJobViewer` reads the profile company for the posting form
  (`service.ts:627-673`); a job can only be posted for a company where `company_members.verified`
  is true (`20261010130000_job_wildcard_criteria.sql:129-136`).
- Company page + jobs payload use the same display-domain ordering: verified claim first, else the
  best hint by confidence (`job_wildcard_criteria.sql:560-572`; `company_directory_hints` /
  `company_page_display_domain` migrations), while `domain_verified` is the separate boolean the
  "Verified" marks key off.

### 8.5 Domain-resolution rules (docs/company-*.md, skimmed)

From `docs/company-domain-resolution.md`:
- Normalisation mirrors `normalizeDomain` in `apps/web/lib/companies/domains.ts`: trim/lowercase,
  strip scheme/userinfo/port/path/www/trailing dot; email → domain part; IDNs are rejected; shape
  must satisfy `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$` (`:24-38`).
- Reduction to the **registrable domain** is what makes a row ownable; subdomains are reduced and
  reported (`subdomain_not_ownable`; `aws.amazon.com → amazon.com`), the suffix set is a curated
  approximation, not the full PSL (`:40-58`).
- Validation ladder: syntax, free/personal provider, non-company TLDs (`gov/mil/edu/int/arpa`,
  rejected-but-reported), platform domains in website fields, subdomain reduction, MX/HTTP/redirect/
  parked/registrar as recorded-but-not-grounds evidence (`:60-81`).
- Classification table `domain_type` (`primary_website`, `corporate_email`, `subsidiary_email`,
  `regional`, `brand`, `subsidiary`, `historical`, `alias`) and derived confidence
  (high = ≥4 points incl. first-party, medium = ≥2 or any first-party, low = 1 or supporting only,
  `evidence_checked=false` caps at low; `redirect_from_website`/`website_domain_match`/`mx_only`
  refused as evidence) (`:83-105`).
- Claims are resolved, never constrained: verified > opinions, a tie at medium+ leaves **no
  steward**, superseded claims are kept by derivation, and only **verification** is unique
  (`company_domains_verified_domain_idx` — one verified claim per domain) (`:107-166`).
- Steward/delegation rules are enforced in
  `supabase/migrations/20260929150000_company_domain_stewardship.sql` (map at `:198-214`).
- From `docs/company-email-domain-resolution.md`: the promotion threshold lives in SQL; a
  mailbox-only proof is recorded as `member_domain_control` evidence and deliberately excluded from
  the resolver's weighting and from the promotion gate; promotions come from
  `review_company_domain` with checked non-OTP evidence (`:9-60`).

### 8.6 Companies admin (web-only)

`/admin/(protected)/companies`; `GET/POST /api/admin/companies` + `PATCH/DELETE
/api/admin/companies/[id]` + featured ordering (`GET/POST /api/admin/companies/featured`), all
`role=admin`. Out of scope for mobile.

---

## 9. Join invite landing — `/join/[token]`

- Page `apps/web/app/join/[token]/page.tsx`: server-fetches `GET /api/communities/join/[token]`
  (anonymous) for the community info; failure → redirect `/dashboard/communities` (`:9-34`).
- Token: 32-char hex extracted from the last 32 chars with dashes stripped; invalid shape → `400`
  (`apps/web/app/api/communities/join/[token]/route.ts:8-13,34-36`); token must match an
  `is_active` community's `invite_token` else `404` (`:38-46`).
- POST (session required; `401` → client redirects to login with `?redirect=/join/<token>`,
  `JoinCommunityClient.tsx:39-43`):
  - already a member → `{status:"already_member", communityId}` (`:75-83`).
  - private → standing-cap check counts **joined + pending** (`loadJoinSlots`/`isCapFull`), at cap →
    `429` with the numbers in the message; else idempotent `community_join_requests` upsert →
    `{status:"requested"}` (`:85-105`). The owner reviews; no auto-accept.
  - public → immediate `community_members` insert → `{status:"joined"}`; the DB membership-cap
    trigger (7 real communities, event rooms excluded) can still raise
    `limit:community_joins` → mapped to `429` (`:107-125`;
    `supabase/migrations/20261013120000_creation_limits.sql:257-318`).
- Client states: `idle|loading|joined|requested|error`; joined redirects to
  `/dashboard/communities/<id>` after 1.2 s (`JoinCommunityClient.tsx:29-69,124-166`); the privacy
  pill ("Public community" / "Private community") reads `community.is_private` (`:92-100`).
- For mobile: this is the deep-link surface; the same GET/POST pair works from RN, and the POST
  body is empty (no JSON required).

---

## 10. Edge-case matrix (what each surface does)

| State | Jobs | Events | Companies |
|---|---|---|---|
| Logged out | `redirect("/login")` on every page; APIs `401` via `requireSession` | same (`events/page.tsx:16`, `EventDetailPage:12`) | same (`[slug]/page.tsx:29-30`); join GET is anonymous |
| Wrong role (admin/session) | user-only | user-only | user-only |
| Not eligible | browse tab hides the role entirely; detail shows lock + mismatches; apply API `403 not_eligible` | — | — |
| Already applied | `Applied` tab; status card; apply API `409 already_applied` | — | — |
| Own post/job | My posts; "View N applicants"; `can_apply=false`; apply API `409 own_job` | owner menu (edit/delete) | own company: leave allowed |
| Closed (owner) | owner-only in feed; Closed badge; apply API `409 job_closed` | — | — |
| Deadline passed | "Expired" badge + amber deadline; apply API `409 job_expired`; reopen clears the date | — | — |
| Event upcoming | RSVP button `I'm Going`; questions modal on join | — | — |
| Event live | badge LIVE; doors still open | — | — |
| Event ended | Join-chat row gone (client + server backstop); RSVP button "This event has ended" | — | — |
| Event ended > 12 h | — | info card replaced by owner carry-on offer; badge gone; room persists | — |
| Online vs in person | — | meet-link row vs location row; both optional; city required either way | — |
| Private room | — | event room always `is_private:false`; join ruled by `is_public || community member` | — |
| Not a member of event's community | — | public event → read-only view; else redirect to the community | — |
| Missing profile city | — | events page empty state + API 422; no events listed | — |
| No saved resumes | ApplyModal upload-only; first upload adopted | — | — |
| Unverified company | — | — | picker shows "No domain on file yet"/hint; `verified:false` |
| Verified vs mailbox-only | — | — | `domainVerified` gates the badge; `verifiedVia` in the confirm response |
| No domain on file | — | — | logo falls back to the initial; search shows the company anyway |
| Missing job (deleted) | `notFound()` on detail; apply API `404` | — | — |
| Empty lists | "No jobs yet" / per-tab empty copy with explanation | "No public events in <city> yet" / "No matching events" | "Nobody has verified a work email here yet." |

---

## 11. Server changes mobile would need (gap list)

Everything below is missing a JSON endpoint (or a JSON-friendly shape) and was verified by reading
`apps/web/app/api/**`:

1. **Job detail JSON** — `GET /api/jobs/[jobId]` does not exist (`apps/web/app/api/jobs/[id]/route.ts`
   only exports `DELETE`). Options: add a thin `GET` (session → `getJobDetail` + label formatting,
   the exact shape `formatJobFeedRows` produces for one row), or have mobile page `/api/jobs/feed`
   and match the id. A `GET` route is the clean fix and also covers "back to this job".
2. **Applicants list JSON** — no `GET` route; the board is RSC-only over `get_job_applicants`, and
   the per-application enrichment (`loadJobApplicantDetails`) is server-side. Mobile needs
   `GET /api/jobs/[jobId]/applicants` (poster-scoped, mapped refusals `not_your_job → 403`,
   `not_installed → 503`).
3. **Company page JSON** — no `GET /api/companies/[slug]`; `get_company_page` is RPC-only. Needed if
   mobile shows the company page from a job/company tap.
4. **Cover upload for event creation** — exists (`POST /api/communities/[id]/events/upload`) but
   must be called with the community id; mobile event creation therefore has to happen from a
   community context (matching web). If mobile wants "create event" from the Events tab, a new
   scope-aware creation path (or documented restriction) is required.
5. **Apply multipart requirement** — no server change strictly needed (RN supports
   `FormData` + `apiFormUpload`), but note `Content-Type` must not be set by the client and the
   backend returns `415` for JSON bodies (`apply/route.ts:49-52`).
6. **No jobs realtime stream** — the jobs board has no room/topic; mobile parity means
   refetch-on-focus/pull-to-refresh, or a new `jobs` notification-driven refresh. Existing
   `job_match` notifications already reach the push pipeline.
7. **Notifications types** — client UIs must handle `job_match` (entity `job`), `event_rsvp`,
   `event_comment`, `event_reply`, `event_deleted`, `content_restored`; the type/entity CHECKs are
   in `supabase/migrations/20261010140000_job_match_notifications.sql:30-60`.

---

## Realtime & notification hooks

### Realtime rooms and topics relevant to this scope

| Scope | Room (client `realtimeRooms`, `apps/web/lib/realtime/rooms.ts`) | Topics published | Publishers |
|---|---|---|---|
| Community events (community tab, event detail) | `events:<communityId>` | `event` (create/update/delete payloads), `rsvp` (`{event:"INSERT"\|"DELETE", event_id, user_id}`), `like` (`{event_id,user_id}`), `save` (`{event_id,user_id}`) | `apps/web/app/api/communities/[id]/events/route.ts:251-264`; `[eventId]/route.ts:213-222`; `[eventId]/rsvp/route.ts:83-85,150-152`; `[eventId]/like/route.ts:47`; `[eventId]/save/route.ts:47`; `lib/communities/content-removal.ts:252,266,509` |
| Event room followers (room members watching the event card beside their chat) | `events:<roomCommunityId>` | `event` | `[eventId]/route.ts:216-221` (PATCH), `content-removal` on delete |
| Room chat | `chat:<roomId>` | `content-insert` — the permanent "<name> created an event" card | `events/route.ts:251-264` (channel `contentEventPayload`) |
| City Events page | **none** — deliberately no community room (`CityEventsView.tsx:32-37`) | — | — |
| Jobs | **none** — no jobs room/topic exists anywhere in the repo | — | — |

- Room routing: community-scoped rooms (`chat:`, `events:`, `threads:`, …) live in the
  `COMMUNITY_DO` with a membership check inside the DO; `notifications:`/`dm:`/`profile:` are
  user-scoped and forced to the caller's own `user:<id>` instance
  (`apps/realtime/src/room-routing.ts:45-99`; client prefixes
  `apps/web/lib/realtime/client.ts:68`).
- Publish path is fire-and-forget with bounded retries and per-event ids for dedupe; the DB is the
  source of truth on missed events (`apps/web/lib/realtime/publish.ts:1-135`). Mobile already has
  its own realtime client (`expo-app-standalone 3/lib/realtimeCore.ts`) using the same rooms.
- RSVP/event mutations also `revalidateTag(HOME_FEED_TAG)` so the cached home feed cannot serve a
  pre-mutation snapshot (`rsvp/route.ts:68,148`; `save/route.ts:56`).

### Notifications

| Event | Type | Entity | Trigger | Notes |
|---|---|---|---|---|
| New match to a fresh posting | `job_match` | `job` | `POST /api/jobs` → `deferJobMatchNotifications` (`apps/web/app/api/jobs/route.ts:94`; `apps/web/lib/jobs/notifications.ts:22-69`) | Deferred `after()`; recipients = `designer_profiles` matching title+level exactly and city/sector unless wildcard, poster excluded (`:31-38`); one `createNotification` per recipient, `Promise.allSettled` (best-effort); title "A new role matches your profile", body = card meta line, href `/dashboard/jobs/<id>` (`:52-62`); unread dedupe identity `(user_id, entity_type, entity_id)` (`20261010140000_job_match_notifications.sql:14-27`) |
| Someone RSVPs to your event | `event_rsvp` | `event` | RSVP route (`rsvp/route.ts:153-163`) | `deferNotification` to the host; href `eventHref(communityId, eventId)` |
| Event comment / reply | `event_comment`, `event_reply` | `event` | comments routes | type list `20261005140000_report_review_and_undo.sql` + `job_match` rebuild (`20261010140000:35-52`) |
| Event deleted (moderated or host) | `event_deleted` | `event` | `[eventId]/route.ts:293-304`, `content-removal` | Body carries the title; moderated deletions also write `community_activities` with actor role |
| Content restored (report review) | `content_restored` | `event` etc. | admin undo | `20261005140000` |
| Push | — | — | Notification rows feed the push pipeline | Mobile settings cover chat push only today (`expo-app-standalone 3/app/settings/notifications.tsx`); jobs/events push would ride the same rows |

### Caches / refresh hints for mobile

- Home feed (public events, job-free) is a server cache invalidated by event/tag writes
  (`HOME_FEED_TAG`); mobile home already calls `GET /api/home/feed` (`MA/lib/homeFeed.ts`).
- City events and jobs have no push channel: the correct mobile pattern is refetch on
  focus + pull-to-refresh (web re-renders the RSC page on navigation and re-fetches cursor pages).
- Applicant triage and job lifecycle writes have no realtime counterpart either; the web relies on
  `router.refresh()` after each write.
