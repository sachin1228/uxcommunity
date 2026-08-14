import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import {
  loadCommunityMessagePage,
  loadCommunityReadModel,
  type ReadResult,
} from "@/lib/communities/read-models";
type Params = { params: Promise<{ id: string }> };
type Section = "community" | "messages";

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

  const body = { ...data, failures };
  const totalDuration = performance.now() - startedAt;
  timings.push(`total;dur=${totalDuration.toFixed(1)}`);

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": timings.join(", "),
      "X-Response-Bytes": String(estimateJsonBytes(body)),
    },
  });
}
