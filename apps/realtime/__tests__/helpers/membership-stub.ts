/**
 * Membership-API stub for the realtime test suites.
 *
 * WHY THIS EXISTS (production-readiness audit, M-8)
 *   `Room.checkMembership` now FAILS CLOSED when `API_URL` is unset: an
 *   unconfigured membership API means a community socket is refused (403)
 *   instead of silently authorized. The local `.dev.vars` deliberately leaves
 *   `API_URL` blank, so without this the suites could not open a community
 *   socket at all.
 *
 *   These helpers give the Worker a real, configured membership API — a tiny
 *   HTTP server that authorizes every check — which is the same shape the
 *   suites relied on implicitly when the code failed open. Tests that need a
 *   non-member or an outage still spin up their own stub and rewrite API_URL.
 *
 * `.dev.vars` is gitignored and local to a checkout; `pointDevVarsAt` restores
 * the original contents when its returned function runs.
 */

import { createServer, type Server } from "http";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export const DEV_VARS_PATH = resolve(__dirname, "../../.dev.vars");

export interface MembershipStub {
  /** Base URL to point API_URL at. */
  url: string;
  stop: () => void;
}

/** Start a local HTTP server that authorizes every membership check. */
export async function startMembershipStub(): Promise<MembershipStub> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => {
      try {
        server.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Rewrite `.dev.vars` so `API_URL` points at `url`, preserving everything else.
 * Returns a function that restores the original contents.
 */
export function pointDevVarsAt(url: string): () => void {
  const original = readFileSync(DEV_VARS_PATH, "utf-8");
  const updated = /^API_URL=.*$/m.test(original)
    ? original.replace(/^API_URL=.*$/m, `API_URL=${url}`)
    : `${original.replace(/\n?$/, "\n")}API_URL=${url}\n`;
  writeFileSync(DEV_VARS_PATH, updated, "utf-8");
  return () => writeFileSync(DEV_VARS_PATH, original, "utf-8");
}
