/**
 * The alert an admin gets when a dependency goes down.
 *
 * WHY THIS EXISTS
 *   The 2026-10-09 upload outage was found by a member, not by the team: a dead
 *   R2 credential 500'd every upload for hours and the only trace was inside
 *   the failing routes. The admin page (apps/web/app/admin/(protected)/health)
 *   answers "is it up?" but only when someone looks, so this is the piece that
 *   looks on its own — driven by the scheduled monitor in apps/realtime, which
 *   decides WHEN to alert (edge-triggered, with a reminder cooldown) and asks
 *   /api/internal/dependency-health to send.
 *
 * WHAT IT SENDS
 *   One email per alert, to every address in ADMIN_EMAIL (comma-separated),
 *   listing each unhealthy dependency with its status, the one-line detail and
 *   the hint naming the value to fix, plus a link to the health page. The
 *   decision of who to alert about lives in lib/health/dependencies.ts: only
 *   checks marked `alerts` page anyone, so a dead GIPHY key or an Upstash blip
 *   never wakes an admin — a rejected Resend key (which silently kills password
 *   resets) does.
 *
 *   Sending is injected on purpose: the composition and the recipient parsing
 *   are what need testing, and a test must never depend on — or spend — the
 *   production email credential.
 */

import { sendAdminAlertEmail } from "@/lib/email";
import type { EmailBlock } from "@/lib/email/document";
import type { DependencyCheck, DependencyReport } from "./dependencies";

/** Injected in tests; the real implementation is `sendAdminAlertEmail`. */
export type AlertSender = (
  to: string,
  alert: { subject: string; preheader: string; heading: string; blocks: EmailBlock[] },
) => Promise<void>;

export interface AlertOutcome {
  sent: boolean;
  /** Why nothing was sent, when nothing was. */
  reason?: string;
  recipients: string[];
  /** Ids the email covered. */
  ids: string[];
}

/**
 * Parses ADMIN_EMAIL into a recipient list.
 *
 * A single address is the documented setup, but a comma-separated list costs
 * nothing here and means a second admin can be added without a code change.
 */
export function alertRecipients(raw: string | undefined = process.env.ADMIN_EMAIL): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
}

function statusWord(check: DependencyCheck): string {
  return check.status === "down" ? "DOWN" : "DEGRADED";
}

/** The email body: what broke, what it breaks for a user, and how to fix it. */
export function alertBlocks(
  checks: DependencyCheck[],
  appUrl: string,
  kind: "down" | "recovered",
): EmailBlock[] {
  if (kind === "recovered") {
    return [
      {
        kind: "paragraph",
        text: `**Every dependency is answering normally again.** The alert for ${checks
          .map((check) => `**${check.label}**`)
          .join(", ")} is over — no action needed if it recovered on its own.`,
      },
      {
        kind: "action",
        label: "Open System Health",
        href: `${appUrl.replace(/\/$/, "")}/admin/health`,
        variant: "primary",
      },
      {
        kind: "finePrint",
        text: "You are receiving this because you are listed as an admin of UX Community. Health checks run every five minutes.",
      },
    ];
  }

  return [
    {
      kind: "paragraph",
      text:
        checks.length === 1
          ? `**${checks[0].label}** is not healthy.`
          : `**${checks.length} dependencies are not healthy**: ${checks
              .map((check) => check.label)
              .join(", ")}.`,
    },
    ...checks.flatMap((check): EmailBlock[] => [
      { kind: "paragraph", text: `**${check.label}** — ${statusWord(check)} (${check.latencyMs} ms)` },
      { kind: "paragraph", text: check.detail },
      ...(check.hint ? [{ kind: "code" as const, value: check.hint }] : []),
    ]),
    {
      kind: "action",
      label: "Open System Health",
      href: `${appUrl.replace(/\/$/, "")}/admin/health`,
      variant: "primary",
    },
    {
      kind: "finePrint",
      text: "You are receiving this because you are listed as an admin of UX Community. Health checks run every five minutes while a dependency stays down at most one reminder per hour.",
    },
  ];
}

/**
 * Emails the admins about a report.
 *
 * `kind` is the monitor's decision, not this function's: the monitor owns the
 * state that tells a new outage from an ongoing one, so this only renders and
 * sends. Returns `{ sent: false }` (never throws) when there is nobody to email
 * or nothing to say — an alert path that throws would turn a monitoring check
 * into an outage of its own.
 */
export async function alertAdmins(
  report: DependencyReport,
  options: {
    kind?: "down" | "recovered";
    /**
     * The ids the monitor says were down. On a recovery this is what makes the
     * email truthful — "the alert for these is over" — instead of naming every
     * monitored service. Falls back to the alertable checks when absent.
     */
    ids?: string[];
    send?: AlertSender;
    recipients?: string[];
    appUrl?: string;
  } = {},
): Promise<AlertOutcome> {
  const kind = options.kind ?? "down";
  const send = options.send ?? sendAdminAlertEmail;
  const recipients = options.recipients ?? alertRecipients();
  const appUrl = options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (!recipients.length) {
    return { sent: false, reason: "ADMIN_EMAIL is not set", recipients, ids: [] };
  }

  // On recovery the monitor passes the ids that were down; on an outage,
  // whatever the report says is broken right now.
  const wanted = options.ids && options.ids.length ? new Set(options.ids) : null;
  const checks =
    kind === "recovered"
      ? report.checks.filter((check) => (wanted ? wanted.has(check.id) : check.alerts))
      : report.alerts;
  if (!checks.length) {
    return { sent: false, reason: "every monitored dependency is healthy", recipients, ids: [] };
  }

  const names = checks.map((check) => check.label).join(", ");
  const heading = kind === "recovered" ? "Services recovered" : "A dependency is down";

  try {
    for (const to of recipients) {
      await send(to, {
        subject:
          kind === "recovered"
            ? `[UX Community] Recovered: ${names}`
            : `[UX Community] ${checks.some((check) => check.status === "down") ? "DOWN" : "Degraded"}: ${names}`,
        preheader: kind === "recovered" ? "Every service is answering again." : checks[0].detail,
        heading,
        blocks: alertBlocks(checks, appUrl, kind),
      });
    }
    return { sent: true, recipients, ids: checks.map((check) => check.id) };
  } catch (error) {
    console.error("[health] admin alert failed to send:", error);
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "send failed",
      recipients,
      ids: checks.map((check) => check.id),
    };
  }
}
