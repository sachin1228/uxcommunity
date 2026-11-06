import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard for the fail-closed rate-limit policy.
 *
 * Every auth/abuse-sensitive route must keep the default `strict` behaviour.
 * `availability` is deliberately limited to the global middleware guard and
 * two low-risk reads; adding it to another route is a security decision that
 * needs this allowlist updated in the same change.
 */

const apiRoot = fileURLToPath(new URL("../../app/api", import.meta.url));
const availabilityAllowlist = new Set([
  "auth/me/route.ts",
  "dm/conversations/[id]/typing/route.ts",
]);

const sensitivePrefixes = [
  "login",
  "reset-request",
  "reset-confirm",
  "change-password",
  "signup",
  "account-delete",
  "account-delete-credential",
  "content-report",
  "interaction-report",
  "dm:report",
  "dm:block",
  "dm:create",
  "dm:request",
  "dm:send",
  "chat:send",
  "thread:create",
  "showcase:create",
  "showcase:comment",
  "resource:create",
  "resource-comment",
  "comment:create",
  "verification",
  "job:apply",
  "company-verification",
  "company-verify",
  "moderation-appeal",
  "moderation-appeal-token",
  "push:register",
  "event:rsvp",
  "profile:avatar",
  "resumes:upload",
];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function relativeRoute(file: string): string {
  return file.slice(apiRoot.length + 1).replaceAll("\\", "/");
}

test("sensitive routes keep the default strict rate-limit mode", () => {
  for (const file of routeFiles(apiRoot)) {
    const source = readFileSync(file, "utf8");
    const relative = relativeRoute(file);
    let index = source.indexOf("rateLimit(");
    while (index >= 0) {
      const call = source.slice(index, index + 400);
      const keyMatch = /rateLimit\(\s*`([^`]+)`/.exec(call);
      if (keyMatch) {
        const key = keyMatch[1];
        const prefix = key.split(":")[0];
        const sensitive = sensitivePrefixes.some(
          (candidate) => prefix === candidate || prefix.startsWith(`${candidate}:`),
        );
        if (sensitive) {
          assert.equal(
            /mode:\s*["']availability["']/.test(call),
            false,
            `${relative} uses availability for security-sensitive limit "${prefix}"`,
          );
        }
      }
      index = source.indexOf("rateLimit(", index + 1);
    }
  }
});

test("availability is confined to the reviewed low-risk routes", () => {
  for (const file of routeFiles(apiRoot)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes('mode: "availability"')) continue;
    assert.ok(
      availabilityAllowlist.has(relativeRoute(file)),
      `${relativeRoute(file)} uses availability without being in the allowlist`,
    );
  }
});

test("critical auth and abuse routes actually carry a limiter", () => {
  const required = [
    "auth/login/route.ts",
    "auth/reset-request/route.ts",
    "auth/reset-confirm/route.ts",
    "auth/change-password/route.ts",
    "signup/direct/route.ts",
    "signup/avatar/route.ts",
    "signup/picture/route.ts",
    "account/delete/route.ts",
    "content-reports/route.ts",
    "interaction-reports/route.ts",
    "dm/reports/route.ts",
    "dm/conversations/[id]/messages/route.ts",
    "communities/[id]/messages/route.ts",
    "communities/[id]/threads/route.ts",
    "communities/[id]/showcase/route.ts",
    "communities/[id]/resources/route.ts",
    "communities/[id]/events/[eventId]/rsvp/route.ts",
    "verification/submit/route.ts",
    "jobs/[id]/apply/route.ts",
    "push/register/route.ts",
  ];

  for (const relative of required) {
    const source = readFileSync(join(apiRoot, relative), "utf8");
    assert.ok(source.includes("rateLimit("), `${relative} has no rate limiter`);
  }
});
