import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
const auditSource = readFileSync(
  fileURLToPath(new URL("./audit.ts", import.meta.url)),
  "utf8",
);

const routes: Record<string, string> = {
  "../../app/api/admin/users/[id]/route.ts": "delete_user",
  "../../app/api/admin/dm-reports/[id]/route.ts": "review_dm_report",
  "../../app/api/admin/reports/[contentType]/[contentId]/route.ts": "remove_content",
  "../../app/api/admin/communities/[id]/route.ts": "toggle_community",
  "../../app/api/admin/jobs/[id]/route.ts": "delete_job",
  "../../app/api/admin/events/[id]/route.ts": "delete_event",
  "../../app/api/admin/verifications/[id]/route.ts": "review_verification",
};

test("every audited admin route uses the shared audit helper and a known action", () => {
  for (const [relative, action] of Object.entries(routes)) {
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
    assert.match(source, /recordAdminAudit/, `${relative} imports/uses recordAdminAudit`);
    assert.match(source, new RegExp(`["']${action}["']`), `${relative} records ${action}`);
    assert.match(auditSource, new RegExp(`["']${action}["']`), `${action} is in the audit action list`);
  }
});
