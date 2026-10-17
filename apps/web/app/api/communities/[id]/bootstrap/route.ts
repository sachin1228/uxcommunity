import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { estimateJsonBytes } from "@/lib/server-timing";
import {
  loadCommunityMessagePage,
  loadCommunityReadModel,
  loadCommunityRules,
  type ReadResult,
} from "@/lib/communities/read-models";
import { loadCommunityContentEvents } from "@/lib/communities/content-events";
import { NO_COMMUNITY_PERMISSIONS, hasAnyCommunityPermission } from "@/lib/communities/permissions";
type Params = { params: Promise<{ id: string }> };
type Section = "community" | "messages" | "content-events" | "rules";

const ALL_SECTIONS: Section[] = ["community", "messages", "content-events", "rules"];

/**
 * Sections that gate the whole response. Rules are a cheap extra bundled so
 * the client's info panel reads them from the hydrated request cache instead
 * of firing a separate fetch; if rules fail, bootstrap still succeeds and
 * the client falls back to the individual endpoint.
 */
const CRITICAL = new Set<Section>(["community", "messages"]);

/**
 * Optional `sections` filter ("community,messages,rules").
 *
 * The client's critical-path request asks for the fast sections only; the
 * slow content-events producer is fetched on its own right after (see the
 * deferred request in lib/request-cache.ts), so the timeline cards no longer
 * delay the read model / message page / rules. Absent or empty means every
 * section: older clients (the Expo app) keep the previous single-request
 * behavior, and so does a plain curl.
 *
 * Returns null for a request that names only unknown sections — a client bug
 * should not silently come back as "everything".
 */
function parseSections(request: NextRequest): Set<Section> | null {
  const raw = request.nextUrl.searchParams.get("sections");
  if (raw === null) return new Set(ALL_SECTIONS);
  const wanted = raw
    .split(",")
    .map((name) => name.trim())
    .filter((name): name is Section => (ALL_SECTIONS as string[]).includes(name));
  return wanted.length ? new Set(wanted) : null;
}

/**
 * Which content areas the chat timeline should show "created a …" cards for:
 * exactly the areas the community's nav shows (showcase reads as on unless the
 * flag says otherwise).
 */
function contentAreaLimits(community: Record<string, unknown> | undefined) {
  const tabs = (community?.enabled_tabs as string[] | null | undefined) ?? null;
  const enabled = (area: string) => tabs === null || tabs.includes(area);
  return {
    threads: enabled("threads"),
    showcase: community?.showcase_enabled !== false,
    events: enabled("events"),
    resources: enabled("resources"),
  };
}

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

export async function GET(request: NextRequest, context: Params) {
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
  const wanted = parseSections(request);
  if (!wanted) {
    return NextResponse.json({ error: "Invalid sections." }, { status: 400 });
  }

  const operations: Array<[Section, () => Promise<unknown>]> = [];
  if (wanted.has("community")) {
    operations.push([
      "community",
      async () => unwrapReadResult(await loadCommunityReadModel(communityId, userId)),
    ]);
  }
  if (wanted.has("messages")) {
    operations.push([
      "messages",
      async () => unwrapReadResult(await loadCommunityMessagePage(communityId, userId)),
    ]);
  }
  if (wanted.has("content-events")) {
    operations.push([
      "content-events",
      async () => {
        const readModel = await loadCommunityReadModel(communityId, userId);
        if (!readModel.ok) return { events: [] };
        const events = await loadCommunityContentEvents(
          communityId,
          contentAreaLimits(readModel.data.community as Record<string, unknown>),
        );
        return { events };
      },
    ]);
  }
  // Rules are bundled into the same request so the info panel never needs its
  // own network round trip. The shape matches the standalone /rules endpoint,
  // and the shared loader is backed by the Next data cache (invalidated on
  // admin rule writes — see loadCommunityRules in read-models.ts).
  if (wanted.has("rules")) {
    operations.push([
      "rules",
      async () => unwrapReadResult(await loadCommunityRules(communityId)),
    ]);
  }

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

  const community = data.community as {
    current_user_role?: string;
    current_user_permissions?: Record<string, boolean>;
  } | undefined;
  const role = community?.current_user_role ?? "member";
  // Merged onto the empty set so a member's payload still carries every
  // toggle, and `can_manage` means "at least one management action", not
  // just "is an admin" — moderators hold grants too.
  const permissions = { ...NO_COMMUNITY_PERMISSIONS, ...(community?.current_user_permissions ?? {}) };
  const body = {
    ...data,
    permissions: {
      role,
      can_manage: hasAnyCommunityPermission(permissions),
      ...permissions,
    },
    unreadCount: 0,
    failures,
  };
  const totalDuration = performance.now() - startedAt;
  const responseBytes = estimateJsonBytes(body);
  timings.push(`total;dur=${totalDuration.toFixed(1)}`);

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": timings.join(", "),
      "X-Response-Bytes": String(responseBytes),
    },
  });
}
