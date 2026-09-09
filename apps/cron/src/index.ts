import { runOrphanSweep } from "./orphan-sweep";
import type { Env } from "./env";

export default {
  /**
   * Weekly Cron Trigger (see wrangler.toml). Runs the sweep and lets the
   * event context finish it. Reports go to the worker logs
   * (`wrangler tail uxcommunity-cron`).
   */
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runOrphanSweep(env).catch((error) => {
        console.error("[orphan-sweep] failed:", error);
      }),
    );
  },

  /**
   * Manual trigger for review: GET/POST / with `x-cron-secret: <CRON_SECRET>`
   * returns the sweep report as JSON. Used to verify a dry run before
   * enabling deletion, without waiting for the weekly schedule.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const secret = env.CRON_SECRET;
    if (!secret || request.headers.get("x-cron-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const report = await runOrphanSweep(env);
      return Response.json(report);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Sweep failed" },
        { status: 500 },
      );
    }
  },
};