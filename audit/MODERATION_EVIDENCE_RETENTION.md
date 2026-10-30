# Moderation evidence retention after account deletion

Date: 2026-10-30
Branch: `feat/preserve-moderation-evidence`
Migration: `supabase/migrations/20261030230000_preserve_moderation_evidence.sql`

## 1. Decision in one page

Moderation reports are evidence. Deleting a member's account must not erase a
report they filed about someone else, the snapshot a moderator needs to review
it, or the audit trail of what was done about it.

The database now:

- detaches the reporter from every report in the same transaction as the
  account deletion;
- keeps the report id, timestamp, target, reason, details, snapshot, status and
  resolution;
- keeps the report reachable from the moderation queue and the audit log;
- displays the reporter as **Deleted user**, never by name or account id;
- leaves no email address, password hash, session token or profile row behind;
- keeps audit rows append-only by removing the foreign-key actions that would
  otherwise try to rewrite them during account deletion.

The report is **not** linked to a deleted-account id, a hash of one, or a
recoverable profile. Once the trigger has run, the report contains no field that
can resolve the reporter to a person.

## 2. What is retained

| Data | Where | Why |
| --- | --- | --- |
| Report id, target type/id, context/community id | `interaction_reports`, `content_reports`, `dm_reports` | Keeps the queue entry, audit link and moderation history coherent |
| `created_at`, `resolved_at`, `status`, `resolution_note`, `resolved_by` | report tables | Shows when the report arrived and what happened to it |
| Report reason and reporter's optional `details` note | report tables | The substance of the allegation and the reporter's explanation |
| `target_excerpt`, `context_title`, `target_author_name` | `interaction_reports` | Lets a reviewer understand the reported content after it is edited or deleted |
| `target_snapshot` (community/job name or title, description, company, owner/poster, lifecycle state) | `interaction_reports` | Structured evidence for whole communities and job listings |
| `content_title`, `content_author_id` where still resolvable | `content_reports` | Identifies the reported post and author while that account exists |
| `message_snapshot` | `dm_reports` | Last messages of the reported conversation at report time, so the queue is self-contained |
| Moderation actions, previous/new state, reason, timestamp | `moderation_audit_log` | Demonstrates that a decision was made, by which moderator/session, and why |
| Historical `moderator_id`, `subject_user_id`, `report_id` values | `moderation_audit_log` | Attribution and linkage. These are plain UUID columns, not foreign keys, so no later account deletion can rewrite an audit row |
| Moderator display-name snapshot (`moderator_label`) | `moderation_audit_log` | Keeps attribution readable if the moderator account is later deleted |
| Acting admin session id (`moderator_sid`) | `moderation_audit_log` | The shared platform-admin login has no users row, so the session is the accountable actor |

The reporter's free-text `details` is retained because it is part of the
allegation. It is not scanned or redacted automatically: a member can type
personal information there. Moderators must treat it as confidential evidence
and must not use it to re-identify an anonymized reporter. If a retention or
legal process requires removal, delete the whole report under the procedure in
§7 rather than trying to surgically rewrite evidence.

## 3. What is anonymized

When a `users` row is deleted, the `trg_anonymize_deleted_user_reports` trigger
runs before the row disappears and updates every report filed by that account:

```sql
reporter_id        = null
reporter_deleted_at = now()
```

It covers all three report queues:

- `interaction_reports` — comments, chat messages, profiles, communities, jobs;
- `content_reports` — threads, showcase posts, resources, events;
- `dm_reports` — direct-message reports.

Resulting behavior:

- `interaction_report_queue.reporter_name` and
  `dm_report_queue.reporter_name` return **Deleted user** when `reporter_id` is
  null.
- `report_groups.reporter_names` includes **Deleted user** rather than dropping
  the reporter from the list.
- The admin pages show **Deleted user** and "Reporter account deleted".
- No report API returns the deleted account's id, because the field is null.
- Reporter notifications were already deleted by the account cascade; the
  resolution engine now skips the thank-you notice when `reporter_id` is null.
- The reporter's `designer_profiles` row, auth sessions, email, password hash,
  push tokens, memberships and authored content are removed by the existing
  account-deletion cascade. None of them is copied into the report.

`target_author_id` and `resolved_by` remain `on delete set null`; deleting a
reported member or a resolving moderator nulls only the live link. Their names
snapshotted on the report (`target_author_name`, `target_snapshot.owner_name` /
`poster_name`) are retained as evidence of who was reported.

### Why the retained target name is not a reporter leak

A report is filed against someone else. The reporter cannot report their own
profile, comment, community or job; the report route rejects that. The target
name therefore describes the affected party, not the reporter. The two are
different people in every valid report.

## 4. Audit log after account deletion

`moderation_audit_log` remains append-only:

- RLS enabled with no policies;
- `anon` and `authenticated` have no privileges;
- `service_role` has `SELECT` and `INSERT` only;
- a trigger rejects every `UPDATE` and every `DELETE`.

The migration removed the `moderator_id`, `subject_user_id` and `report_id`
foreign keys. This is deliberate:

- Their `on delete set null` actions are updates. The append-only trigger
  correctly rejects updates, so keeping the FKs would make deleting a
  previously-moderated account fail — the account would be stuck, and a partial
  deletion could leave moderation records inconsistent.
- Audit rows are historical statements. They must not be rewritten because a
  person later erased their account.
- A future evidence-retention purge can remove an old report without the audit
  table trying to null its `report_id`.

The ids stay in the row as historical identifiers. `moderator_label` is written
at action time, so deleting a moderator account cannot turn an old decision into
"Platform admin". The admin feed prefers the label, then a live user name.
`moderator_sid` remains the attribution for the shared admin login.

### Is retaining a historical UUID compatible with anonymization?

For the **reporter**, no identifier is retained at all. For the **moderator**
and **affected account**, the UUID is retained for accountability and dispute
resolution, not for re-identification of a reporter. It is not a foreign key, so
it no longer resolves to a live profile through the schema. It could still be
correlated with backups, logs or other historical records; treat it as
pseudonymous personal data, not as anonymous data, and restrict access
accordingly.

## 5. Who can access retained evidence

| Surface | Access | What is exposed |
| --- | --- | --- |
| `/admin/interaction-reports` | live admin session (`requireSession("admin")`) | Report, snapshot, reason, reporter label, target |
| `/admin/reports` | live admin session | Grouped post reports and reporter names |
| `/admin/dm-reports` | live admin session | DM report, message snapshot, reporter label |
| `/admin/audit-log` | live admin session, read-only | Actions, states, historical ids, moderator label/session |
| `interaction_reports`, `content_reports`, `dm_reports`, `moderation_audit_log` | `service_role` only | Full rows |
| Member-facing pages/APIs | none | No report or evidence endpoint |

Ordinary members cannot read or write any report table. Reported members never
receive the reporter's id, name or any report metadata; platform notifications
have `actor_id = null`.

## 6. Retention period — proposed policy decision

**This is a proposal, not a legal requirement.** UXCommunity has not set a
retention period in law or in a signed policy. The following is recommended for
review by counsel/privacy lead before launch:

> **Proposed:** retain closed moderation evidence (report rows and snapshots)
> for **24 months from the last moderation action on the report**, then purge it
> under §7, unless the report is under appeal, subject to a legal hold, or part
> of an active law-enforcement request. Audit rows are not deleted by that
> routine purge; retain them at least as long as their report and set a separate
> audit-retention schedule with counsel (a starting proposal is the same 24
> months, with a legal-hold exception, but it must be reviewed before any audit
> purge).

Why 24 months is a starting point, not a conclusion:

- it covers a repeat-offender window and the usual time in which a moderation
  decision is disputed;
- it is long enough to investigate a pattern across accounts;
- it is short enough to respect storage limitation and erasure expectations.

Open reports, pending appeals and legal holds are excluded from the cutoff.
Dismissed reports may be reviewed for a shorter period if counsel prefers.
Whatever period is chosen must be written into the privacy policy and the
member-facing deletion explanation, and applied consistently.

## 7. How evidence is eventually deleted

There is no automated purge job in this branch. Until one exists, deletion is a
controlled maintenance procedure, not an application action:

1. **Select candidates.** Query closed reports older than the approved cutoff
   that are not `pending`, not under an open appeal, and not under legal hold.
2. **Two-person approval.** Privacy lead plus moderation lead approve the batch
   and record the cutoff, count and reason outside the audit table.
3. **Export the decision record.** Keep the audit rows; they are the record that
   a decision happened. Do not export reporter identity — there is none.
4. **Delete report rows in a transaction.** Delete dependent appeals first if
   the policy requires it, then the report. Because the audit table no longer
   has a `report_id` foreign key, the audit row is not updated and the
   append-only trigger is not involved.
5. **Verify.** Report counts fall by the approved batch; audit row counts are
   unchanged; no `report_id` in the audit table was modified.
6. **Record the purge.** Log the maintenance operation in the protected ops log
   (not the append-only moderation audit, which describes moderation decisions,
   not infrastructure maintenance).

Audit rows are deliberately **not** part of this routine purge. They are the
accountability record even after the evidence is gone. If counsel requires audit
rows to be deleted, that is a separate break-glass operation by the database
owner: two-person approval, a documented legal basis, the append-only trigger
temporarily disabled inside a reviewed transaction, and verification afterwards.
It is not a moderation-queue action and must never be exposed in the app.

Example shape (run only after approval, never as part of a deploy):

```sql
-- Review first; substitute the approved cutoff and ids.
select id, status, created_at, resolved_at
from public.interaction_reports
where status <> 'pending'
  and coalesce(resolved_at, created_at) < now() - interval '24 months';

begin;
delete from public.moderation_appeals
 where report_id in (/* approved ids */);
delete from public.interaction_reports
 where id in (/* approved ids */);
commit;
```

Do not run this against production from this branch. Do not delete audit rows to
"clean up" a report. Audit rows are the accountability record.

## 8. Privacy and legal review required

This document is engineering documentation, not legal advice. Before launch,
counsel/privacy review should confirm at least:

- the lawful basis for retaining evidence after the reporter's account is gone;
- whether the chosen retention period satisfies applicable law (for example
  India's DPDP Act, GDPR where it applies, and any local record-keeping rules);
- how erasure/access requests are handled when the requester is the reporter,
  the reported member, or a third party quoted in a DM snapshot;
- whether `dm_reports.message_snapshot` contains third-party personal data that
  needs a separate retention rule or redaction process;
- whether any category of report (threats, illegal activity, minors, fraud)
  needs a longer legal-hold period;
- whether audit rows containing historical UUIDs count as pseudonymous personal
  data and what access/logging controls they need;
- cross-border storage and processor terms for the database and backups;
- how backups age out, because deleting a live row does not delete a backup;
- how law-enforcement and safety escalations are documented and access-logged;
- whether the member-facing privacy policy and account-deletion email accurately
  describe the retention in this document.

Until that review is complete, do not describe the 24-month figure as a legal
retention period in public copy. Describe it as an internal review target.

## 9. Known limitations

1. **No automated retention job.** The procedure in §7 is manual.
2. **Audit historical ids are pseudonymous, not anonymous.** They are retained
   for accountability and are not removed by the routine report purge; access is
   admin-only, but correlation with backups/logs is theoretically possible. An
   audit-retention schedule still needs legal approval.
3. **Reporter free-text can contain personal data.** It is retained as evidence;
   moderators must not use it to re-identify an anonymized reporter.
4. **Reported-member names remain in snapshots.** This is intentional evidence,
   not reporter data. If the reported member also erases their account, their
   live link is nulled but the name snapshot stays.
5. **The migration was not applied to staging or production.** Apply it to a
   staging database, run the SQL tests and the manual checks in §10, then apply
   through the normal release process.
6. **Generated Supabase types are stale.** Regenerate
   `apps/web/lib/supabase/database.types.ts` after applying the migration; it
   currently predates `interaction_reports` and still marks the older reporter
   columns as non-null.

## 10. Verification and migration instructions

### Local verification performed

```bash
npm run test:moderation-db
# equivalent to:
# bash supabase/tests/run-local.sh supabase/tests/moderation_evidence_retention.test.sql \
#   supabase/tests/moderation_evidence_concurrency.test.sql
```

Result: **62 retention assertions pass, 6 concurrency assertions pass, 0
failures**, against a scratch PostgreSQL built from `schema.sql` plus all
migrations. The harness reports `ok: 82` and `ok: 8` because its counter also
matches `select ok(...)` column headers; the assertion counts are 62 and 6.

The tests prove:

- all three reporter foreign keys are nullable and `on delete set null`;
- the trigger anonymizes every queue in the deletion transaction;
- report ids, timestamps, reasons, details, snapshots, status and audit links
  survive;
- queue views show **Deleted user** and expose no reporter id;
- target, moderator and community deletion leave reports and snapshots intact;
- resolution after reporter deletion still works;
- audit rows survive and still reject update/delete;
- an evidence purge can delete a report without touching audit history;
- a report insert racing an account delete either commits before the delete and
  is anonymized, or loses the race and fails its foreign key — it never leaves a
  report pointing at a deleted account.

### Applying the migration

1. Back up the staging database and record current counts:
   ```sql
   select 'interaction' as queue, count(*) from public.interaction_reports
   union all select 'content', count(*) from public.content_reports
   union all select 'dm', count(*) from public.dm_reports
   union all select 'audit', count(*) from public.moderation_audit_log;
   ```
2. Apply `20261030230000_preserve_moderation_evidence.sql` **after**
   `20261030220000_complete_moderation_system.sql`, through the normal migration
   pipeline. Do not apply it to production from this branch.
3. Run the SQL tests against staging.
4. Re-run the count query. No report count should decrease; only reporter
   references are nulled for accounts deleted during the migration window.
5. Verify the schema:
   ```sql
   select conname, pg_get_constraintdef(oid)
   from pg_constraint
   where conname like '%reporter_id_fkey';
   ```
   The three reporter FKs must say `ON DELETE SET NULL`.
6. Verify the trigger exists:
   ```sql
   select tgname from pg_trigger
   where tgrelid = 'public.users'::regclass
     and tgname = 'trg_anonymize_deleted_user_reports';
   ```
7. Regenerate the Supabase types and deploy the application change that treats
   `reporter_id` as nullable.
8. Perform one staging deletion: create a member, file a report, delete the
   member, confirm the report is still in the queue, the reporter reads
   **Deleted user**, and the audit row is unchanged.
