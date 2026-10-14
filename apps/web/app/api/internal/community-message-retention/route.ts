import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteR2Objects, getR2KeyFromUrl } from "@/lib/r2";
import { publishChatEvent } from "@/lib/realtime/server";
import {
  sweepExpiredChatMessages,
  type RetentionSideEffects,
  type RetentionStore,
} from "@/lib/communities/message-retention-sweep";

/**
 * Internal endpoint behind the community chat's 15-day retention sweep.
 *
 * The realtime Worker's cron POSTs here (see apps/realtime/src/retention.ts);
 * nothing here is reachable from a browser session. Authentication mirrors the
 * other server-to-server endpoint the Worker calls
 * (app/api/internal/dependency-health): a bearer API_SECRET, the same value in
 * both Workers.
 *
 * A run deletes messages older than the retention window, removes their R2
 * images, and tells each affected community's room over realtime. It is
 * idempotent and budgeted — an unfinished backlog is reported via
 * `summary.complete = false` / `summary.pendingMessages` and picked up by the
 * next cron tick.
 *
 * `dry_run` (body or `?dry_run=1`) reports the backlog WITHOUT deleting
 * anything — the way to size the first sweep before letting it run.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) return false;
  return req.headers.get("authorization") === `Bearer ${apiSecret}`;
}

/** The database half of the sweep, against the service-role client. */
function createRetentionStore(): RetentionStore {
  const db = createServiceClient();
  return {
    async listExpired(cutoffIso, limit) {
      const { data, error } = await db
        .from("community_messages")
        .select("id, community_id, image_url")
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`[retention] list expired failed: ${error.message}`);
      return (data ?? []) as unknown as Array<{
        id: string;
        community_id: string;
        image_url: string | null;
      }>;
    },
    async countExpired(cutoffIso) {
      const { count, error } = await db
        .from("community_messages")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoffIso);
      if (error) throw new Error(`[retention] count expired failed: ${error.message}`);
      return count ?? 0;
    },
    async deleteByIds(ids) {
      const { error } = await db.from("community_messages").delete().in("id", ids);
      if (error) throw new Error(`[retention] delete failed: ${error.message}`);
    },
  };
}

/** R2 cleanup + the realtime announcement to each affected room. */
function createRetentionSideEffects(): RetentionSideEffects {
  return {
    async deleteImages(urls) {
      const keys: string[] = [];
      for (const url of urls) {
        const key = getR2KeyFromUrl(url);
        if (key) keys.push(key);
      }
      const outcome = await deleteR2Objects(keys);
      return {
        deleted: outcome.deleted.length,
        skipped: urls.length - keys.length,
        failed: outcome.failed,
      };
    },
    async announceExpired(communityId, cutoffIso) {
      await publishChatEvent({
        communityId,
        topic: "messages-expired",
        data: { cutoff: cutoffIso },
      });
    },
  };
}

export async function POST(req: NextRequest) {
  if (!process.env.API_SECRET) {
    return NextResponse.json({ ok: false, error: "API_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  try {
    const body = (await req.json()) as { dry_run?: unknown } | null;
    if (body?.dry_run === true) dryRun = true;
  } catch {
    // No body (or a malformed one) leaves the query-param decision standing.
  }

  try {
    const summary = await sweepExpiredChatMessages(
      { store: createRetentionStore(), effects: createRetentionSideEffects() },
      { dryRun },
    );
    return NextResponse.json(
      { ok: true, summary },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[retention] sweep failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "sweep failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
