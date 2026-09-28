/**
 * Membership-API stub for the realtime test suites.
 *
 * WHY THIS EXISTS (production-readiness audit, M-8)
 *   `Room.checkMembership` FAILS CLOSED when `API_URL` is unusable: an
 *   unconfigured membership API means a community socket is refused (403)
 *   instead of silently authorized. A checkout whose `.dev.vars` has no usable
 *   `API_URL` therefore cannot open a community socket at all, so the suites
 *   need one that answers — a tiny HTTP server that authorizes every check.
 *   That is the same shape the suites relied on implicitly when the code failed
 *   open. Tests that need a non-member or an outage still spin up their own stub
 *   and rewrite `API_URL` for a fresh Worker.
 *
 * `.dev.vars` is gitignored and belongs to the developer, not to the test run,
 *   so `pointDevVarsAt` rewrites `API_URL` alongside a recovery copy of the
 *   file taken before the first rewrite. A run killed before its teardown
 *   (Ctrl-C, a stop-the-task button, a build timeout) would otherwise leave
 *   `API_URL` aimed at a stub port that no longer listens — which refuses every
 *   community socket in local dev until someone notices. `restoreDevVarsFromBackup`
 *   is what the next run calls before doing anything else.
 */

import { createServer, type Server } from "http";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

export const DEV_VARS_PATH = resolve(__dirname, "../../.dev.vars");

/**
 * Recovery copy of `.dev.vars`, written before the first rewrite of a run and
 * removed as soon as the file is back to what the developer had.
 */
export const DEV_VARS_RECOVERY_PATH = `${DEV_VARS_PATH}.backup`;

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
 * Put the recovery copy back and drop it. Returns true when a copy was found —
 * i.e. when a previous run was killed before it could restore the file.
 * Idempotent, and a no-op when there is nothing to repair.
 */
export function restoreDevVarsFromBackup(): boolean {
  if (!existsSync(DEV_VARS_RECOVERY_PATH)) return false;
  try {
    writeFileSync(DEV_VARS_PATH, readFileSync(DEV_VARS_RECOVERY_PATH, "utf-8"), "utf-8");
    rmSync(DEV_VARS_RECOVERY_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrite `.dev.vars` so `API_URL` points at `url`, preserving everything else.
 * Returns a function that restores the original contents.
 */
export function pointDevVarsAt(url: string): () => void {
  const original = readFileSync(DEV_VARS_PATH, "utf-8");
  // Only the FIRST rewrite of a run takes the copy: a suite pointing API_URL at
  // its own stub later must not replace the developer's original with a stub
  // URL, or the recovery copy would restore the wrong value.
  if (!existsSync(DEV_VARS_RECOVERY_PATH)) {
    writeFileSync(DEV_VARS_RECOVERY_PATH, original, "utf-8");
  }

  const updated = /^API_URL=.*$/m.test(original)
    ? original.replace(/^API_URL=.*$/m, `API_URL=${url}`)
    : `${original.replace(/\n?$/, "\n")}API_URL=${url}\n`;
  writeFileSync(DEV_VARS_PATH, updated, "utf-8");

  return () => {
    writeFileSync(DEV_VARS_PATH, original, "utf-8");
    // Drop the copy once the file holds its pre-run contents again; a nested
    // restore (a suite's own stub) leaves it in place for the run's teardown.
    try {
      if (
        existsSync(DEV_VARS_RECOVERY_PATH) &&
        readFileSync(DEV_VARS_RECOVERY_PATH, "utf-8") === original
      ) {
        rmSync(DEV_VARS_RECOVERY_PATH);
      }
    } catch {
      /* Tidying the copy is a safety net, not part of the test result. */
    }
  };
}
