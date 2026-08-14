import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import { GET as getCommunity } from "../route";
import { GET as getMessages } from "../messages/route";
import { GET as getStats } from "../stats/route";
import { GET as getRules } from "../rules/route";
import { GET as getThreads } from "../threads/route";
import { GET as getEvents } from "../events/route";
import { GET as getShowcase } from "../showcase/route";
import { GET as getResources } from "../resources/route";
import { GET as getMembers } from "../members/route";

type Params = { params: Promise<{ id: string }> };
type Section = "community" | "messages" | "stats" | "rules" | "threads" | "events" | "showcase" | "resources" | "members";

const CRITICAL = new Set<Section>(["community", "messages"]);

async function readSection(
  name: Section,
  operation: () => Promise<Response>,
): Promise<{ name: Section; value: unknown; duration: number }> {
  const startedAt = performance.now();
  const response = await operation();
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : `Request failed (${response.status})`;
    throw new Error(`${name}: ${message}`);
  }
  return { name, value, duration: performance.now() - startedAt };
}

export async function GET(request: NextRequest, context: Params) {
  const startedAt = performance.now();
  try {
    await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const authDuration = performance.now() - startedAt;
  const sectionRequest = new NextRequest(request.url, { headers: request.headers });
  const operations: Array<[Section, () => Promise<Response>]> = [
    ["community", () => getCommunity(sectionRequest, context)],
    ["messages", () => getMessages(sectionRequest, context)],
    ["stats", () => getStats(sectionRequest, context)],
    ["rules", () => getRules(sectionRequest, context)],
    ["threads", () => getThreads(sectionRequest, context)],
    ["events", () => getEvents(sectionRequest, context)],
    ["showcase", () => getShowcase(sectionRequest, context)],
    ["resources", () => getResources(sectionRequest, context)],
    ["members", () => getMembers(sectionRequest, context)],
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
