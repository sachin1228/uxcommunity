import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import {
  loadCommunityEvents,
  loadCommunityMembersPage,
  loadCommunityMessagePage,
  loadCommunityReadModel,
  loadCommunityResources,
  loadCommunityRules,
  loadCommunityShowcasePage,
  loadCommunityStats,
  loadCommunityThreads,
  type ReadResult,
} from "@/lib/communities/read-models";
type Params = { params: Promise<{ id: string }> };
type Section =
  | "community"
  | "messages"
  | "rules"
  | "stats"
  | "events"
  | "threads"
  | "resources"
  | "members"
  | "showcase";

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
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const authDuration = performance.now() - startedAt;
  const { id: communityId } = await context.params;
  const userId = session.userId!;
  const operations: Array<[Section, () => Promise<unknown>]> = [
    ["community", async () => unwrapReadResult(await loadCommunityReadModel(communityId, userId))],
    ["messages", async () => unwrapReadResult(await loadCommunityMessagePage(communityId, userId))],
    ["rules", async () => unwrapReadResult(await loadCommunityRules(communityId))],
    ["stats", async () => unwrapReadResult(await loadCommunityStats(communityId))],
    ["events", async () => unwrapReadResult(await loadCommunityEvents(communityId, userId))],
    ["threads", async () => unwrapReadResult(await loadCommunityThreads(communityId, userId))],
    ["resources", async () => unwrapReadResult(await loadCommunityResources(communityId, userId))],
    ["members", async () => unwrapReadResult(await loadCommunityMembersPage(communityId, userId))],
    ["showcase", async () => unwrapReadResult(await loadCommunityShowcasePage(communityId, userId, null))],
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
      events: ((data.events as { events?: unknown[] } | undefined)?.events ?? []).length,
      threads: ((data.threads as { threads?: unknown[] } | undefined)?.threads ?? []).length,
      resources: ((data.resources as { resources?: unknown[] } | undefined)?.resources ?? []).length,
      members: ((data.members as { members?: unknown[] } | undefined)?.members ?? []).length,
      showcase: ((data.showcase as { posts?: unknown[] } | undefined)?.posts ?? []).length,
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
