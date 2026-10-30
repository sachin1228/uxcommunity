#!/usr/bin/env node
/**
 * Emails the admins when a scheduled backup or verification run fails.
 *
 * WHY A SEPARATE ALERT AND NOT JUST THE RED RUN
 *   A failed scheduled workflow notifies whoever is watching the repository, and
 *   nobody watches a repository at 03:00. Backups fail silently in a specific
 *   way — nothing breaks, so nobody notices for months — and the failure is only
 *   discovered during the incident it was supposed to cover. This sends the one
 *   message that makes the failure visible to a human.
 *
 * WHY IT NEVER FAILS THE JOB
 *   The job has already failed; a second failure from the alerting step would
 *   only obscure the first. Delivery problems are logged and the process exits 0.
 *
 * Uses Resend directly over HTTPS (no SDK) so the CI job needs no install.
 *
 * ENV: RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL, plus GitHub's own GITHUB_* vars.
 */

import { log } from "./lib/log.mjs";

function recipients(raw) {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = recipients(process.env.ADMIN_EMAIL);
  const stage = process.env.BACKUP_STAGE || "backup";

  if (!apiKey || !from || to.length === 0) {
    log.warn("alert not sent: RESEND_API_KEY, EMAIL_FROM or ADMIN_EMAIL is not configured", {
      hasKey: Boolean(apiKey),
      hasFrom: Boolean(from),
      recipients: to.length,
    });
    return;
  }

  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  const subject = `UXCommunity ${stage} FAILED`;
  const lines = [
    `The scheduled ${stage} run failed.`,
    "",
    `Repository: ${process.env.GITHUB_REPOSITORY ?? "(local)"}`,
    `Workflow:   ${process.env.GITHUB_WORKFLOW ?? "(local)"}`,
    `Run:        ${runUrl ?? "(no run url)"}`,
    "",
    "Until this is fixed, the most recent successful backup is the newest",
    "recovery point. Check the run log, fix the cause, then trigger the",
    "workflow manually (Actions → Backup → Run workflow).",
    "",
    "Runbook: audit/DISASTER_RECOVERY_RUNBOOK.md",
  ];

  const html = `<pre style="font:13px/1.5 ui-monospace,Menlo,monospace">${escapeHtml(lines.join("\n"))}</pre>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      log.warn("alert could not be sent", { status: response.status });
      return;
    }
    log.info("failure alert sent", { recipients: to.length });
  } catch (error) {
    log.warn("alert could not be sent", { error: String(error?.message ?? error) });
  }
}

main().catch((error) => {
  log.warn("alert step failed (ignored)", { error: String(error?.message ?? error) });
});
