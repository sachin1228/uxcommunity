# Report handling procedure

Operational runbook for the moderation team. It describes exactly what a
reviewer does from the moment a report lands to the moment it is closed, and
what happens to the record afterwards.

Related: [community guidelines](community-guidelines.md) (the rules members
see) and [moderation policy](moderation-policy.md) (severity, actions, appeals).

## 0. Before you start

- You need an administrator login. Moderator actions are not available to
  ordinary members: every moderation route requires an admin session.
- Read the report from the **Moderation queue** in the admin dashboard. The
  queue holds comments, chat messages, profiles, communities and job listings.
  Post-level reports remain in **Reports**; direct-message reports remain in
  **DM Reports**.
- Moderation is best-effort on business days. Critical items (credible threats,
  content involving minors, doxxing, active fraud) should be handled first.

## 1. Triage

1. Open the queue and filter to **Pending**.
2. Filter by **Type**, **Reason**, or a **date range** to work a theme.
3. Sort visually by severity (see policy §2). Critical first, then serious,
   then moderate, then advisory.
4. If a report names a safety emergency, escalate immediately: preserve the
   evidence, do not delete it, and follow the escalation path in §7.

## 2. Read the evidence

Expand the report row. You get:

- the report type and target name;
- the reported content excerpt and its author/owner;
- the reporter and when the report was filed;
- the reporter's optional note;
- for communities and job listings, a structured snapshot (description,
  company, owner/poster, lifecycle state);
- **Previous moderation actions** against the same target, from the audit log.

Decide from the snapshot. The target may have been edited or deleted since the
report was filed; the snapshot is the record of what was reported. If you need
to see the target in context, open it from the link, but do not let an edited
version replace the evidence.

## 3. Check for duplicates and history

- The platform prevents a member from filing two open reports against the same
  target. Multiple reports against one target from different members appear as
  separate rows — handle the substantive one, then resolve the rest with the
  same reasoning (each resolution is audited separately).
- Check **Previous moderation actions** in the expanded row before escalating.
  The policy's escalation ladder depends on the account's history.

## 4. Choose the action

Pick the least action that resolves the harm:

| Situation | Action |
| --- | --- |
| Report is mistaken, or the content is not a violation | **Dismiss report** — add an internal note explaining why |
| Comment or chat message violates the guidelines | **Remove content** — plus an account action if severity ≥ 3 or the member has history |
| Community description, rules or conduct violates the guidelines | **Hide community** — plus an account action against the owner if warranted |
| Job listing is fake, scam, discriminatory, spam, or asks for payment | **Deactivate job** — plus an account action for scam or repeat behaviour |
| Profile is the problem (impersonation, harassment, hate) | **Warn / Suspend / Ban** the account; profiles are not deleted from the queue |
| Critical violation, or repeated Level-4 behaviour | **Ban user** |

Write a clear note. It is stored in the audit log and quoted to the affected
member — write it as the explanation the member will read, without identifying
the reporter.

Confirm destructive actions in the dialog. The dialog states what survives:
job applications, community membership and content, and the report's evidence.

### Safety rules that are enforced by the system

- A deactivated job keeps every application and applicant record.
- A hidden community keeps its members, owner, chat history and content.
- A deleted comment or message is **not** recoverable; the evidence snapshot
  is what remains.
- Moderation never deletes a report row, an audit row, or evidence.
- Account actions revoke the member's live sessions immediately.

## 5. Close the report

On confirm, the system:

1. performs the action;
2. marks the report `removed` (content/community/listing), `actioned` (account
   action), or `dismissed`;
3. writes one append-only audit row with previous and new state;
4. notifies the reporter that the report was reviewed;
5. notifies the affected member with the reason and the appeal link, unless the
   action was a dismissal.

Re-check the queue afterwards: a report you resolved should leave the Pending
filter.

## 6. Appeals

Members appeal once per decision from **Moderation appeals** in their
dashboard. Administrators review them in **Appeals**:

1. Read the appeal and the report snapshot side by side.
2. **Grant** to reverse the decision where possible:
   - ban → account unblocked (the member must sign in again);
   - suspension → lifted;
   - hidden community → restored;
   - deactivated job → reopened;
   - deleted comment or message → cannot be restored; the member is told so.
3. **Deny** to uphold the decision — add a short note explaining why, since the
   member receives it.
4. Every appeal decision is audited.

A granted appeal is not an erasure: the original decision and its audit rows
remain. Both decisions are part of the record.

## 7. Escalation

Escalate to the platform administrator when:

- the violation may require law-enforcement involvement (credible threats,
  child safety, fraud at scale);
- the action would delete content or a community outright rather than
  hide/deactivate it;
- the account involved is staff, a moderator, or a community owner with a
  dispute of interest;
- the appeal challenges a ban and the original moderator is unavailable;
- the same actor appears in multiple unrelated reports (possible coordinated
  abuse).

Do not share reporter identity or private member data while escalating; share
the report id and the audit trail.

## 8. Daily and weekly checks

Daily (business days):

- work the Pending queue by severity;
- check **Appeals** for new submissions;
- confirm no report has been left resolved without an audit row (the queue
  lists the previous actions, which is the quickest sanity check).

Weekly:

- review the audit log for unexpected actions or a moderator acting outside
  policy;
- look for repeat targets and repeat reporters;
- check that hidden communities and deactivated jobs with granted appeals were
  actually restored.

## 9. What not to do

- Do not dismiss a report without reading the evidence snapshot.
- Do not use moderation actions to settle a personal disagreement or to remove
  criticism of UXCommunity.
- Do not reveal, hint at, or confirm the reporter's identity to anyone.
- Do not delete content when hiding or deactivating is sufficient.
- Do not remove a job listing by deleting the posting; that would destroy
  applicant data.
- Do not edit or attempt to delete audit records — the database rejects it.
- Do not use a member's report to browse their unrelated private data.
- Do not promise a response time to a reporter; the confirmation copy is
  deliberately non-committal because moderation is not staffed 24/7.
