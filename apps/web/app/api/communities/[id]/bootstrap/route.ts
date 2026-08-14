import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import {
  loadCommunityBootstrapReadModel,
  loadCommunityMessagePage,
  type ReadResult,
} from "@/lib/communities/read-models";

type Params = { params: Promise<{ id: string }> };
type TimingMap = Record<string, number>;

function unwrapReadResult<T>(result: ReadResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function timingHeader(timings: TimingMap) {
  return Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
    .join(", ");
}

export async function GET(_request: NextRequest, context: Params) {
  const startedAt = performance.now();
  const timings: TimingMap = {};
  const measureDb = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const operationStartedAt = performance.now();
    try {
      return await operation();
    } finally {
      timings[name] = performance.now() - operationStartedAt;
    }
  };

  let session;
  const authStartedAt = performance.now();
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  } finally {
    timings.auth = performance.now() - authStartedAt;
  }

  const { id: communityId } = await context.params;
  const userId = session.userId!;
  const failures: Array<{ section: "community" | "messages"; message: string }> = [];

  let communityData;
  try {
    communityData = unwrapReadResult(
      await loadCommunityBootstrapReadModel(communityId, userId, measureDb),
    );
  } catch {
    failures.push({ section: "community", message: "Section unavailable." });
  }

  let messageData;
  if (communityData) {
    try {
      messageData = unwrapReadResult(
        await loadCommunityMessagePage(communityId, userId, {}, {
          membership: communityData.membership,
          measure: measureDb,
        }),
      );
    } catch {
      failures.push({ section: "messages", message: "Section unavailable." });
    }
  }

  if (!communityData || !messageData) {
    timings.total = performance.now() - startedAt;
    console.info(JSON.stringify({
      event: "performance.community_bootstrap",
      community_id: communityId,
      duration_ms: Math.round(timings.total),
      db_duration_ms: Math.round((timings.db_membership ?? 0) + (timings.db_community ?? 0) + (timings.db_messages ?? 0)),
      db_operations: timings,
      failures,
    }));
    return NextResponse.json(
      { error: "Section unavailable.", failures },
      { status: 502, headers: { "Server-Timing": timingHeader(timings) } },
    );
  }

  const { membership: _membership, ...community } = communityData;
  const role = community.current_user_role;
  const body = {
    community,
    messages: messageData,
    permissions: {
      role,
      can_manage: role === "owner" || role === "admin",
    },
    unreadCount: 0,
    failures,
  };
  timings.total = performance.now() - startedAt;
  const responseBytes = estimateJsonBytes(body);
  const dbDuration = (timings.db_membership ?? 0) + (timings.db_community ?? 0) + (timings.db_messages ?? 0);

  console.info(JSON.stringify({
    event: "performance.community_bootstrap",
    community_id: communityId,
    duration_ms: Math.round(timings.total),
    db_duration_ms: Math.round(dbDuration),
    db_budget_ms: 300,
    db_budget_met: dbDuration < 300,
    db_operations: {
      membership_ms: Math.round(timings.db_membership ?? 0),
      community_ms: Math.round(timings.db_community ?? 0),
      messages_ms: Math.round(timings.db_messages ?? 0),
    },
    response_bytes: responseBytes,
    returned_counts: { messages: messageData.messages.length },
  }));

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": timingHeader(timings),
      "X-Database-Duration-Ms": dbDuration.toFixed(1),
      "X-Response-Bytes": String(responseBytes),
    },
  });
}
