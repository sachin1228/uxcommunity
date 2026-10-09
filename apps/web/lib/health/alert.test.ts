import test from "node:test";
import assert from "node:assert/strict";

import { alertAdmins, alertBlocks, alertRecipients, type AlertSender } from "./alert";
import type { DependencyCheck, DependencyReport } from "./dependencies";

function check(overrides: Partial<DependencyCheck> = {}): DependencyCheck {
  return {
    id: "r2",
    label: "Cloudflare R2 (media)",
    status: "down",
    severity: "critical",
    alerts: true,
    latencyMs: 42,
    detail: "R2 rejected the media credential (Unauthorized HTTP 401).",
    hint: "Rotate R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.",
    ...overrides,
  };
}

function report(checks: DependencyCheck[]): DependencyReport {
  return {
    checkedAt: "2026-10-09T15:00:00.000Z",
    healthy: checks.every((entry) => entry.severity !== "critical" || entry.status === "ok"),
    allOk: checks.every((entry) => entry.status === "ok"),
    alerts: checks.filter((entry) => entry.alerts && entry.status === "down"),
    checks,
  };
}

/** Records what would have been sent. */
function recordingSender() {
  const sent: Array<{ to: string; subject: string; heading: string; blocks: unknown[] }> = [];
  const send: AlertSender = async (to, alert) => {
    sent.push({ to, subject: alert.subject, heading: alert.heading, blocks: alert.blocks });
  };
  return { send, sent };
}

test("alertRecipients reads one address or a list, and ignores junk", () => {
  assert.deepEqual(alertRecipients("ops@example.in"), ["ops@example.in"]);
  assert.deepEqual(alertRecipients("ops@example.in, second@example.in"), [
    "ops@example.in",
    "second@example.in",
  ]);
  assert.deepEqual(alertRecipients("not-an-address"), []);
  assert.deepEqual(alertRecipients(""), []);
  assert.deepEqual(alertRecipients(undefined), []);
});

test("an unhealthy dependency produces one email per recipient, naming the fix", async () => {
  const { send, sent } = recordingSender();
  const outcome = await alertAdmins(report([check(), check({ id: "supabase", status: "ok" })]), {
    send,
    recipients: ["ops@example.in", "second@example.in"],
    appUrl: "https://app.example.in",
  });

  assert.equal(outcome.sent, true);
  assert.equal(sent.length, 2, "both admins must be alerted");
  assert.equal(sent[0].subject, "[UX Community] DOWN: Cloudflare R2 (media)");
  assert.match(sent[0].blocks[0] ? JSON.stringify(sent[0].blocks[0]) : "", /is not healthy/);
  const rendered = JSON.stringify(sent[0].blocks);
  assert.match(rendered, /Rotate R2_ACCESS_KEY_ID/, "the hint an operator acts on must be in the body");
  assert.match(rendered, /https:\/\/app\.example\.in\/admin\/health/, "the alert must link the page");
  assert.deepEqual(outcome.ids, ["r2"]);
});

test("nothing is sent when the only broken services do not page anyone", async () => {
  const { send, sent } = recordingSender();
  const outcome = await alertAdmins(
    report([
      check({ id: "giphy", label: "GIPHY (GIF search)", severity: "supporting", alerts: false }),
    ]),
    { send, recipients: ["ops@example.in"] },
  );

  assert.equal(outcome.sent, false);
  assert.match(outcome.reason ?? "", /healthy/);
  assert.equal(sent.length, 0, "a dead GIPHY key must not email anyone");
});

test("no recipients means no send, and no throw", async () => {
  const { send, sent } = recordingSender();
  const outcome = await alertAdmins(report([check()]), { send, recipients: [] });

  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, "ADMIN_EMAIL is not set");
  assert.equal(sent.length, 0);
});

test("a send failure is reported, not thrown", async () => {
  const outcome = await alertAdmins(report([check()]), {
    recipients: ["ops@example.in"],
    send: async () => {
      throw new Error("Resend rejected the API key");
    },
  });

  assert.equal(outcome.sent, false);
  assert.match(outcome.reason ?? "", /Resend rejected/);
});

test("the recovery email says what recovered and asks for nothing", () => {
  const blocks = alertBlocks([check({ status: "ok" })], "https://app.example.in/", "recovered");
  const rendered = JSON.stringify(blocks);

  assert.match(rendered, /Every dependency is answering normally again/);
  assert.match(rendered, /https:\/\/app\.example\.in\/admin\/health/);
  assert.equal(rendered.includes("Rotate"), false);
});

test("a recovering report sends the recovery kind when asked", async () => {
  const { send, sent } = recordingSender();
  const outcome = await alertAdmins(report([check({ status: "ok" })]), {
    kind: "recovered",
    send,
    recipients: ["ops@example.in"],
  });

  assert.equal(outcome.sent, true);
  assert.equal(sent[0].heading, "Services recovered");
  assert.match(sent[0].subject, /^\[UX Community\] Recovered:/);
});

test("a recovery email names only what the monitor said was down", async () => {
  const { send, sent } = recordingSender();
  const outcome = await alertAdmins(
    report([
      check({ status: "ok" }),
      check({ id: "resend", label: "Resend (transactional email)", status: "ok" }),
    ]),
    { kind: "recovered", ids: ["resend"], send, recipients: ["ops@example.in"] },
  );

  assert.equal(outcome.sent, true);
  assert.deepEqual(outcome.ids, ["resend"]);
  const rendered = JSON.stringify(sent[0].blocks);
  assert.match(rendered, /Resend/);
  assert.equal(rendered.includes("Cloudflare R2 (media)"), false, "never-broken services stay out");
});
