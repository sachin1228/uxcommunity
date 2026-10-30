# UXCommunity moderation policy

This is the internal policy the moderation team follows. It defines severity
levels, the actions available for each report type, how evidence is handled,
and how appeals work. It complements the member-facing
[community guidelines](community-guidelines.md) and the operational
[report handling procedure](report-handling-procedure.md).

The member-facing guidelines are the rulebook; this document is the
enforcement framework.

## 1. Principles

1. **Least action that resolves the harm.** Remove content before restricting an
   account; warn before suspending; suspend before banning.
2. **Consistency.** The same violation gets the same treatment regardless of who
   reported it or who committed it.
3. **Evidence first.** Decide from the evidence snapshot on the report, not from
   memory or from the reporter's framing.
4. **Reporter confidentiality.** The reported member never learns who reported
   them, on any surface, including notifications and appeal outcomes.
5. **Reversibility.** Prefer reversible actions. A hidden community can be
   restored; a deleted comment cannot. Deleted comments are not recoverable,
   which is why the report's snapshot is preserved.
6. **No permanent evidence deletion.** Moderation action never deletes the
   report row or its snapshot.

## 2. Severity levels

| Level | Name | Description | Typical action |
| --- | --- | --- | --- |
| 1 | Advisory | Off-topic, low-effort, minor profile or listing issues | Dismiss with note, or a warning |
| 2 | Moderate | Spam, misleading community information, inappropriate content, expired/misleading listing | Remove content / hide community / deactivate listing; warning |
| 3 | Serious | Harassment, hate, discrimination, impersonation, scam or fraudulent recruitment, suspicious payment requests, doxxing | Remove content plus suspension (3–30 days) |
| 4 | Critical | Credible threats, sexual content involving minors, illegal activity, coordinated fraud, repeated Level-3 behaviour after a suspension | Content removal, then permanent ban |

Severity is set by the nature of the content, the harm it can cause, and the
member's history — not by how upset the reporter is.

### Repeat offenders

Moderation is cumulative across the account:

- first Level-2 violation → warning, or removal with a warning note;
- second Level-2 within 90 days → suspension (3–7 days);
- third Level-2, or any Level-3 after a suspension → suspension up to 30 days;
- any Level-4, or continued violations after a 30-day suspension → permanent ban.

A single Level-4 violation can justify an immediate ban without the escalation
steps. Record the reasoning on the report so the next reviewer can see it.

## 3. Recommended response times

Moderation is **not a 24/7 staffed service**. The queue is reviewed on business
days, best-effort. These are internal targets, not published guarantees:

| Severity | Target first response |
| --- | --- |
| Critical | within 24 hours |
| Serious | within 48 hours |
| Moderate | within 5 business days |
| Advisory | within 10 business days |
| Appeals | within 10 business days |

If the queue is unattended, no copy anywhere in the product may promise an
immediate answer. The report confirmation copy says a human will review it, not
that a reply is immediate.

## 4. Actions by target type

The moderation queue supports five target types. The available actions differ
because the consequences differ.

### Comments and chat messages (thread, showcase, resource, event, community chat)

- **Remove content** — deletes the comment or message. The report keeps the
  excerpt, author name and surrounding context as evidence.
- **Warn / Suspend / Ban** — account-level actions against the author.
- **Dismiss** — closes the report with no action.

### Profiles

- **Warn / Suspend / Ban** — accounts are restricted, never deleted from the
  queue. Profile text itself can be moderated by the account holder or by an
  administrator from the member page.
- **Dismiss.**

### Communities

- **Hide community** — sets the community inactive. Membership, ownership,
  chat history, threads, showcase posts, resources and events are preserved.
  Use this instead of deletion unless a member-created community is itself
  unlawful, in which case escalate to an administrator for deletion.
- **Warn / Suspend / Ban** — against the community owner, when the owner is the
  responsible party. Master-data communities have no owner; only Hide and
  Dismiss apply.
- **Dismiss.**

Hidden communities are restored automatically when an appeal is granted.

### Job listings

- **Deactivate listing** — closes the posting and flags it as moderated. The
  listing leaves the job board and stops accepting applications, but
  **applications, applicant data and résumés are never deleted by moderation**.
  The poster cannot reopen a moderated listing; only a granted appeal (or an
  administrator) can.
- **Warn / Suspend / Ban** — against the poster.
- **Dismiss.**

Deleting a posting outright (owner delete or administrator delete) is a
separate, destructive action and is out of scope for the moderation queue.

## 5. Evidence and snapshots

When a report is filed, the platform stores on the report:

- the reporter, the target type and target id;
- the target's author/owner and display name at report time;
- an excerpt of the reported text;
- the surrounding context title and community;
- for communities and job listings, a structured snapshot (name/title,
  description, company, owner/poster, lifecycle state);
- the reason and the reporter's optional note;
- the timestamp.

This snapshot is what a reviewer decides from, and it survives the target being
edited or deleted. **Do not delete report rows or snapshots as part of a
moderation action.** If the reported member's account is deleted, the author
link is nulled by the schema and the report remains. If the **reporter** deletes
their own account, the existing schema cascades their reports away; the
structured snapshot does not survive that case (see the implementation audit's
remaining gaps).

## 6. Audit log

Every moderation action writes an append-only audit row recording:

- the moderator (admin session id; the platform admin login has no user row);
- the action taken;
- the target type and id, and the report id;
- the affected account, where applicable;
- the previous state and the new state;
- the reason (report reason plus the moderator's note);
- the timestamp.

Audit rows cannot be edited or deleted, including by an administrator: the
database has no update/delete privilege for the application and a trigger
rejects both. Only administrators can read the log.

## 7. Notifications

- **Reporter** — told the report was reviewed, and whether action was taken.
  Never told which account was actioned, or anything about other reports.
- **Affected member** — when content is removed, a community is hidden, a
  listing is deactivated, or an account is warned, suspended or banned: told
  what happened, the reason, and where to appeal.
- **Appellant** — told the outcome of the appeal and any decision note.

Platform notices never carry an actor, so the reporter's identity cannot leak
through a notification.

## 8. Appeals

- One appeal per moderation decision, per member.
- Only the affected account may appeal.
- A member may file at most three appeals per 24 hours.
- Appeals are reviewed by an administrator, not by the moderator who took the
  original action where staff availability allows.
- Granting an appeal:
  - lifts a suspension or ban (the member must sign in again);
  - restores a hidden community;
  - reopens a deactivated listing;
  - cannot restore a deleted comment or message — the decision is corrected in
    the audit log and the member is told the content cannot be restored.
- Denying an appeal closes the appeal with a note; the original decision stands.

## 9. Moderator conduct and confidentiality

- Moderators do not use the moderation surfaces to read unrelated private user
  information. The queue exposes only the reported target and the accounts
  involved.
- Reports, appeals, and audit entries are confidential. Do not quote a report
  outside the moderation team, and never share reporter identity.
- Conflicts of interest (reporting or moderating content involving yourself, a
  colleague, or a direct competitor) must be handed to another moderator.
- Moderators do not moderate content solely because it is critical of
  UXCommunity. Legitimate criticism is not a violation.

## 10. Data protection

- Applicant résumés are private objects; moderation never exposes or downloads
  them.
- Reporter identity and report details are visible only to administrators.
- Evidence is retained for the life of the report for audit and appeal use.
- Deleted content is not recoverable, which is why removal is reserved for
  violations of these policies and never used as a first response to
  disagreement.
