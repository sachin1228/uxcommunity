# Moderation implementation audit

Date: 2026-10-30
Branch: `feat/complete-moderation-system`
Scope: `apps/web`, `expo-app-standalone 3`, `supabase/migrations`, `docs`.

## Executive summary

UXCommunity already had a working reporting path for comments, community chat
messages and profiles: the `interaction_reports` table, evidence snapshots,
duplicate-open-report protection, an admin queue, delete/dismiss actions and a
reporter thank-you notification. That system was **extended**, not rebuilt.

This branch adds the two missing target types — whole communities and job
listings — to the same queue, and adds the parts the existing implementation
did not have:

- per-target reason lists for communities and job listings;
- moderator actions for hiding a community, deactivating a job listing, and
  warning, suspending or banning the responsible account;
- an append-only moderation audit log with previous/new state;
- a member appeal flow, including signed email links for banned or suspended
  members who cannot sign in;
- explicit enforcement that a moderated job keeps every application and a
  hidden community keeps its members and content;
- the three policy documents and this audit.

No production database, deployment or migration was touched.

## 1. What existed before

| Area | Existing implementation | Reused? |
| --- | --- | --- |
| Comments / replies | `interaction_reports`, admin queue, delete action | Yes, unchanged behavior |
| Community chat messages | same queue, delete action + R2 cleanup | Yes |
| Profiles | same queue, no delete (account action from member page) | Yes, extended with account actions in the queue |
| Evidence | `target_excerpt`, `context_title`, author name snapshotted at report time | Yes, plus a structured `target_snapshot` for communities/jobs |
| Duplicate reports | partial unique index on `(reporter, target_type, target_id) WHERE status='pending'` | Yes, automatically covers the new types |
| Rate limiting | 30 reports/hour per member | Yes, plus a tighter 10/hour cap for communities and jobs |
| Reporter notification | `report_reviewed` notification | Yes |
| Admin authorization | `requireSession("admin")` on every admin route | Yes |
| Notifications | `notifications` type/entity checks, `create_notification` RPC | Extended with two types and one entity type |
| Session/account state | `is_blocked` ban with immediate revocation | Extended with `suspended_until` |
| Cache/UI | shared `ReportModal` (web) and `ContentReportModal` (mobile) | Extended with per-target reasons |

The audit found **no existing audit log, no appeal mechanism, no temporary
suspension, no community reporting and no job reporting**.

## 2. Requirement coverage

### 2.1 Missing reporting options

**Communities** — reportable from:

- the community page header's `⋯` action menu (`ChatHeader.tsx`);
- the About panel in the right sidebar (`CommunityRightSidebar.tsx`);
- the mobile community `⋯` menu (`CommunityMenu.tsx`);
- the mobile community info/About screen (`CommunityInfoView.tsx`).

Reasons: inappropriate community content, harassment or hate, spam or scams,
impersonation, illegal or harmful activity, misleading community information,
other.

Captured: community id, name, description snapshot, owner id/name, type,
active state, reporter id, reason, details and timestamp.

**Job listings** — reportable from:

- the job detail page header (`JobDetail.tsx`);
- each job card's action menu (`JobCard.tsx` → `JobReportMenu.tsx`);
- the mobile job detail screen (`app/(tabs)/jobs/[id]/index.tsx`).

Reasons: fake or misleading job, scam or fraudulent recruitment, spam,
discriminatory requirements, inappropriate content, suspicious payment
requests, impersonation of a company, expired or misleading opportunity, other.

Captured: job id, title, company id/name, poster id/name, description snapshot,
status/closing date, reporter id, reason, details and timestamp.

**Evidence survives deletion.** The snapshot is written onto the
`interaction_reports` row at report time; moderation actions never update or
delete it. The queue view reads the snapshot, not the target.

### 2.2 Unified moderation queue

All five required target types live in `interaction_reports` and render in
`/admin/interaction-reports`:

- comments and replies (thread, showcase, resource, event);
- community chat messages;
- profiles;
- communities;
- job listings.

The queue shows report type, reason, reporter, reported account, content
snapshot, submission date, status and previous moderation actions. Filters:
status, target type, reason and a from/to submitted-date range.

Post-level reports (`content_reports`: threads, showcase posts, resources,
events) remain in `/admin/reports`. They were intentionally left on their
existing removal/restore machinery rather than merged, because collapsing two
different removal models would have risked the existing functionality the task
required preserving.

### 2.3 Moderator actions

| Target | Actions |
| --- | --- |
| Comment / chat message | Remove content, warn, suspend, ban, dismiss |
| Profile | Warn, suspend, ban, dismiss (never deletes the account) |
| Community | Hide community, warn, suspend, ban, dismiss |
| Job listing | Deactivate job, warn, suspend, ban, dismiss |

Safety properties, enforced in code and guarded by tests:

- **Jobs are closed, never deleted.** `status='closed'`, `moderated_at` set,
  `job_applications` untouched. A database trigger stops the poster reopening a
  moderated listing.
- **Communities are hidden, never deleted.** `is_active=false`; members,
  ownership, messages, threads, resources and events are untouched.
- **Evidence is never deleted** by a moderation action.
- **Destructive actions require confirmation** in the admin dialog, which
  names what survives.
- Account actions revoke live sessions immediately. Suspension is up to 30 days
  and self-expires; ban is `is_blocked=true`.
- Master-data communities have no owner, so account actions are disabled for
  them; only Hide and Dismiss are offered.

### 2.4 Audit log

`moderation_audit_log` records moderator id (null for the shared admin login),
admin session id, action, target type/id, report id, subject account, previous
state, new state, reason and timestamp.

Protection:

- RLS enabled, no policies;
- `anon`/`authenticated` have no privileges;
- `service_role` has only `SELECT`/`INSERT`;
- a trigger raises on every `UPDATE` or `DELETE`, including from SQL.

Admin UI: `/admin/audit-log`, read-only, filterable by target type, action and
date, with expandable previous/new state. Every report row also shows the prior
actions against its target.

### 2.5 Notifications and appeals

When a report is resolved:

- the reporter gets a `report_reviewed` notice (never told who was actioned or
  anything about other reports);
- the affected member gets a `moderation_action` notice for removals, hides,
  deactivations, warnings, suspensions and bans, with the reason and an appeal
  link;
- platform notices have `actor_id = null`, so reporter identity cannot leak;
- both notices use the new `moderation` entity type keyed by the report id, so
  they cannot aggregate into an unrelated unread notification.

Appeals:

- one appeal per report, enforced by a unique index;
- only the account the decision was taken against may appeal;
- only `removed` or `actioned` reports are appealable;
- 20–2000 characters, three appeals per member per 24 hours;
- in-product form at `/dashboard/appeals` for members who can sign in;
- **signed email link** for suspended/banned members: HMAC-SHA256 over the
  report id + user id with `SESSION_SECRET`, 30-day expiry, report-scoped, no
  session required. The API re-checks the report owner.
- granting an appeal lifts a ban/suspension, restores a hidden community, or
  reopens a deactivated job. A deleted comment/message cannot be restored; the
  member is told so.
- every appeal decision is audited.

### 2.6 Policies

- `docs/community-guidelines.md` — member-facing rules covering harassment and
  hate, threats and violence, spam and scams, fraudulent job listings,
  impersonation, sexual/inappropriate content, discrimination, personal
  information, illegal activity and repeat offenders.
- `docs/moderation-policy.md` — severity levels, response-time targets,
  per-target actions, evidence, audit, notifications, appeals and moderator
  conduct.
- `docs/report-handling-procedure.md` — operational triage-to-close runbook,
  escalation and daily/weekly checks.

None of the documents claim 24/7 staffing. They state that moderation is
best-effort on business days and publish internal targets, not guarantees.

## 3. Implementation map

### Database

`supabase/migrations/20261030220000_complete_moderation_system.sql`

- `interaction_reports`: target types `community`/`job`; six new reason ids;
  status `actioned`; `target_snapshot jsonb`; `resolution_note`; filter indexes.
- `moderation_audit_log` + append-only trigger/grants.
- `moderation_appeals` + one-per-report unique index.
- `users.suspended_until` + `set_user_suspended` RPC (deadline, version bump,
  session revocation).
- `job_posts.moderated_at`, `moderation_note`, reopen guard trigger.
- Rebuilt `interaction_report_queue` view with snapshot/resolver columns.
- `notifications`: `moderation_action`, `appeal_reviewed`, `moderation` entity.

### Server

- `lib/communities/report-reasons.ts` — target-aware reason vocabulary;
  validation used by both clients and the API.
- `lib/moderation/interaction-reports.ts` — target loading for communities and
  jobs, snapshots, safe removal for comments/messages.
- `lib/moderation/action-catalog.ts` — client-safe action list/labels.
- `lib/moderation/resolve-report.ts` — action engine: semantics, audit,
  notifications, restriction email.
- `lib/moderation/audit.ts` — append-only writes, target history, admin feed.
- `lib/moderation/appeals.ts` — appeal eligibility and validation.
- `lib/moderation/appeal-token.ts` — signed email appeal links.
- `lib/auth/liveness.ts`, `session-validity.ts`, `session.ts` — suspension
  enforcement in HTTP and realtime session validation.
- `lib/notifications.ts` — new types/entity.
- `lib/email` — restriction/appeal email template and sender.

Routes:

- `POST /api/interaction-reports` (extended).
- `GET /api/admin/interaction-reports` (filters).
- `PATCH /api/admin/interaction-reports/[id]` (actions).
- `GET /api/admin/moderation/audit`.
- `GET /api/admin/moderation-appeals`, `PATCH /api/admin/moderation-appeals/[id]`.
- `GET/POST /api/moderation/appeals` (session).
- `POST /api/moderation/appeals/token` (signed link).

### Web UI

- `components/communities/ReportModal.tsx` — per-target reasons.
- `components/communities/chat/ChatHeader.tsx` — Report community menu item.
- `components/communities/CommunityRightSidebar.tsx` — Report community in About.
- `components/jobs/JobReportMenu.tsx`, `JobCard.tsx`, `JobDetail.tsx` —
  Report job.
- `app/admin/(protected)/interaction-reports/page.tsx` — unified queue.
- `components/admin/moderation/ModerationActionDialog.tsx` — confirmation.
- `app/admin/(protected)/audit-log/page.tsx`.
- `app/admin/(protected)/moderation-appeals/page.tsx`.
- `app/dashboard/appeals/*` — member appeals.
- `app/appeals/[token]/*` — emailed signed-link appeal.
- `AdminSidebar` — Moderation queue, Appeals, Audit log.

### Mobile

- `lib/contentReports.ts` — mirrored per-target reasons and new types.
- `components/community/ContentReportModal.tsx` — per-target reasons.
- `components/community/CommunityMenu.tsx` — Report community.
- `components/community/CommunityInfoView.tsx` — Report community in About.
- `app/community/[id].tsx` — modal wiring.
- `app/(tabs)/jobs/[id]/index.tsx` — Report job.
- `lib/notifications.ts`, `app/notifications.tsx` — moderation notification
  type, tab and icon.

Both clients call the same `/api/interaction-reports` endpoint with the same
values, so web and mobile behavior cannot drift.

## 4. Security review

| Requirement | Control |
| --- | --- |
| Report creation server-authorized | `requireSession("user")` on both report routes; target owner/excerpt/context derived from the DB row, never from the request |
| Validate target existence/ownership | target loaded by type+id; 404 when absent; self-report refused for the target's author/owner |
| Prevent arbitrary-ID reports | the client may only name a target type and UUID; snapshots are server-derived |
| Rate limiting | 30/hour overall; 10/hour for communities/jobs; 3 appeals/day; 10 token submissions/hour/IP |
| Duplicate open reports | partial unique index (existing), now covering the new types |
| RLS / admin authorization | report/audit/appeal tables are service-role only and RLS-enabled; every admin route calls `requireSession("admin")`; source-audit test enforces both |
| Moderator access to unrelated private data | queue returns only the report, its snapshot and involved accounts; appeals return name/block/suspension state, not emails or profiles |
| Evidence protected | `interaction_report_queue` and `interaction_reports` grants are service-role only; no member-facing endpoint exposes them |
| Reporter identity private | admin-only queue; `actor_id` null on all platform notices; affected-member copy never references the reporter (guarded by test) |
| Mobile/web parity | one endpoint and one server-side reason validator |

Additional controls:

- Suspension and ban revoke every registry session; realtime session validation
  reads the same `suspended_until`/`is_blocked` fields.
- Audit rows reject UPDATE/DELETE at the database.
- The emailed appeal token is HMAC-signed, expiring, report-scoped and
  re-checked against the report owner; fails closed on malformed input.
- Moderation actions on jobs/communities never touch applications or
  memberships.

## 5. Verification performed

### Passed

| Check | Command | Result |
| --- | --- | --- |
| Web TypeScript | `npx tsc --noEmit -p apps/web/tsconfig.json` | pass, 0 errors |
| Mobile TypeScript | `npx tsc --noEmit -p "expo-app-standalone 3/tsconfig.json"` | pass, 0 errors |
| Moderation unit/source tests | `npm run test:moderation` | **74 pass, 0 fail** |
| Email templates | `npx tsx --test apps/web/lib/email/templates.test.ts` | 15 pass, 0 fail |
| Notification tabs (web) | `npx tsx --test apps/web/lib/notifications-tabs.test.ts` | 10 pass |
| Notification model (mobile) | `npx tsx --test "expo-app-standalone 3/lib/notifications.test.ts"` | 9 pass |
| Production build | `npm run build` | exit 0; `/dashboard/appeals`, `/appeals/[token]`, `/admin/audit-log`, `/admin/moderation-appeals`, `/admin/interaction-reports` and every new API route compiled |
| Lint (changed/new files) | `eslint` on the changed paths | 0 errors, 0 warnings |
| Lint (whole web app) | `npm run lint` | **fails on 46 pre-existing errors** unrelated to this branch (e.g. `react-hooks/set-state-in-effect` in `DropdownMenu.tsx`, `useDmTyping.ts`); no new error was introduced by the changed files |

The 74 tests cover:

- per-target reason lists and rejection of a reason offered for another target;
- the full persisted reason vocabulary;
- allowed actions per target and the non-removable set
  (profile/community/job);
- destructive-action classification and suspension bounds;
- appeal eligibility, ownership, message bounds and blocked copy;
- signed appeal tokens: round-trip, tampering, foreign secret, expiry,
  malformed input;
- suspension in `isActiveUserRow`, `evaluateSession` and the erasure path;
- source-level guards: user/admin session requirements, evidence snapshots,
  job applications untouched, community memberships untouched, append-only
  audit table, reporter identity absent from affected-member notices,
  one-appeal-per-report + rate limiting, suspension wired through the session
  evaluator.

### Not executed (and why)

There is **no local Supabase/Postgres runtime in this workspace** (`docker` is
not installed), and no production access was authorized. Therefore the
following were **not** run end-to-end, and no claim is made that they passed:

1. Report a community from web.
2. Report a community from mobile.
3. Report a job from web.
4. Report a job from mobile.
5. Report comments, chat messages and profiles (regression).
6. Duplicate report handling against a live database.
7. Rate limiting against Redis.
8. Admin queue filtering against a live database.
9. Admin dismissal/removal/hide/deactivate/account actions.
10. Evidence surviving target deletion in a live database.
11. Ordinary users blocked from moderation routes (covered only by the
    source-level authorization audit).
12. Reporter identity privacy in live notification rows.
13. Notifications delivered/rendered in both apps.
14. Appeals submitted and reviewed, including a granted ban appeal.

The migration was written but **not applied** to any database. Before launch it
must be applied to a staging database, then the 14 scenarios above exercised
there. See §7.

## 6. Remaining gaps and risks

1. **Migration not applied anywhere.** Deploy requires applying
   `20261030220000_complete_moderation_system.sql` before the new client code.
   The report API inserts `target_snapshot`; without the migration, community
   and job reports (and the new notification values) fail.
2. **No end-to-end tests.** The database/API/UI flows in §5 are unverified in a
   running stack. Unit tests cover the pure decisions and source invariants,
   not SQL execution or route behavior.
3. **Deleted comments/messages cannot be restored by an appeal.** Removal is a
   hard delete (existing behavior). The evidence snapshot and audit record
   survive; granting the appeal records the correction and notifies the member.
   A future soft-delete/retention window would close this gap.
4. **Hard-deleting a community is not a queue action.** Hiding is the queue's
   maximum action because it preserves membership/ownership/content. Genuinely
   unlawful member-created communities must be escalated and deleted through
   the existing admin community delete route.
5. **The admin login is shared.** There is no per-moderator account, so
   `moderator_id` is null for admin sessions and attribution is by admin
   session id. A real per-moderator identity would require an account system
   for administrators.
6. **Email delivery depends on Resend + `NEXT_PUBLIC_APP_URL`.** If either is
   missing, the moderation action still succeeds (the email failure is logged),
   but a banned member has no self-service appeal path until support is
   contacted.
7. **No moderation SLA automation.** Response times are documented targets;
   nothing pages a moderator. The product does not claim 24/7 coverage.
8. **Appeals have no admin pagination UI.** The API supports pages; the admin
   list shows the selected status without a pager. This is cosmetic at current
   volumes.
9. **Post-level reports remain in a separate queue.** This preserves their
   existing removal/restore machinery but means “all reports” is split between
   Moderation queue (interactions/communities/jobs) and Reports (posts). The
   acceptance list (profile, comment, chat, community, job) is fully unified.
10. **Evidence retention is indefinite.** No retention/erasure policy for
    report snapshots exists yet; it should be decided with legal review.
11. **A reporter deleting their account cascades their reports away.** This is
    the pre-existing `interaction_reports.reporter_id ... on delete cascade`
    behavior. It means the snapshot of the reported target is lost when the
    reporter erases their account. Preserving those reports would require a
    nullable reporter + `ON DELETE SET NULL` migration and a decision about
    whether retaining them is appropriate; it is deliberately left out of this
    branch to avoid changing account-erasure semantics.

## 7. Recommended pre-launch checklist

1. Apply the migration to staging (never production from this branch), then to
   production during the deploy window.
2. Verify `set_user_suspended`, the audit trigger and the job reopen guard in
   staging with a real Postgres.
3. Run the 14 scenarios in §5 against staging; record results in this file or a
   follow-up audit.
4. Create at least one test community report and one test job report from each
   client, confirm both appear in the queue with snapshots, and resolve one
   with each action type.
5. Suspend a test account, confirm immediate sign-out, confirm the email appeal
   link works, grant the appeal and confirm the account can sign in again.
6. Confirm `RESEND_API_KEY`, `EMAIL_FROM` and `NEXT_PUBLIC_APP_URL` are set in
   the target environment.
7. Confirm no production moderation queue contains a report that was resolved
   without an audit row.

## 8. Files changed

See `git status` on `feat/complete-moderation-system`. The migration, the three
policy documents, the audit document, the moderation library/route/UI files and
the mobile reporting entry points are all new or modified in place; no existing
reporting behavior was removed.
