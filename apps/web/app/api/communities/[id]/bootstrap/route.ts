import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import { createServiceClient } from "@/lib/supabase/service";
import {
  loadCommunityMessagePage,
  loadCommunityReadModel,
  type ReadResult,
} from "@/lib/communities/read-models";
type Params = { params: Promise<{ id: string }> };
type Section = "community" | "messages" | "rules";

/**
 * Sections that gate the whole response. Rules are a cheap
 * extras bundled so the client's info panel reads them from the hydrated
 * request cache instead of firing separate fetches; if one fails, the
 * bootstrap still succeeds and the client falls back to the individual
 * endpoint.
 */
const CRITICAL = new Set<Section>(["community", "messages"]);

async function readSection(
  name: Section,
  operation: () => Promise<unknown>,
): Promise<{ name: Section; value: unknown; duration: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { name, value, duration: performance.now() - startedAt };
}

function unwrapReadResult<T>(result: ReadResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export async function GET(_request: NextRequest, context: Params) {
  const startedAt = performance.now();
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const authDuration = performance.now() - startedAt;
  const { id: communityId } = await context.params;
  const userId = session.userId!;
  const db = createServiceClient();
  const operations: Array<[Section, () => Promise<unknown>]> = [
    ["community", async () => unwrapReadResult(await loadCommunityReadModel(communityId, userId))],
    ["messages", async () => unwrapReadResult(await loadCommunityMessagePage(communityId, userId))],
    // Cheap rules are bundled into the same request so the info panel never
    // needs its own network round trip. The shape matches the standalone
    // /rules endpoint so the hydrated
    // request-cache entries are interchangeable with them.
    ["rules", async () => {
      const { data, error } = await db
        .from("community_rules")
        .select("id, rule_text, order_index")
        .eq("community_id", communityId)
        .order("order_index", { ascending: true });
      if (error) throw new Error("Failed to load rules.");
      return { rules: data ?? [] };
    }],
  ];

  const settled = await Promise.allSettled(
    operations.map(([name, operation]) => readSection(name, operation)),
  );
  const data: Record<string, unknown> = {};
  const failures: Array<{ section: Section; message: string }> = [];
  const timings: string[] = [`auth;dur=${authDuration.toFixed(1)}`];

  settled.forEach((result, index) => {
    const section = operations[index][0];
    if (result.status === "fulfilled") {
      data[section] = result.value.value;
      timings.push(`${section};dur=${result.value.duration.toFixed(1)}`);
    } else {
      failures.push({ section, message: "Section unavailable." });
    }
  });

  const criticalFailure = failures.find(({ section }) => CRITICAL.has(section));
  if (criticalFailure) {
    return NextResponse.json(
      { error: criticalFailure.message, failures },
      { status: 502 },
    );
  }

  const community = data.community as { current_user_role?: string } | undefined;
  const body = {
    ...data,
    permissions: {
      role: community?.current_user_role ?? "member",
      can_manage: community?.current_user_role === "owner" || community?.current_user_role === "admin",
    },
    unreadCount: 0,
    failures,
  };
  const totalDuration = performance.now() - startedAt;
  const responseBytes = estimateJsonBytes(body);
  timings.push(`total;dur=${totalDuration.toFixed(1)}`);
  console.info(JSON.stringify({
    event: "performance.community_bootstrap",
    community_id: communityId,
    duration_ms: Math.round(totalDuration),
    response_bytes: responseBytes,
    returned_counts: {
      messages: ((data.messages as { messages?: unknown[] } | undefined)?.messages ?? []).length,
    },
  }));

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": timings.join(", "),
      "X-Response-Bytes": String(responseBytes),
    },
  });
}
