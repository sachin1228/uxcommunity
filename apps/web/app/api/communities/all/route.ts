import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const timer = createServerTimer("GET /api/communities/all");

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (error) {
    timer.finish({ status: error instanceof Response ? error.status : 500 });
    return error as Response;
  }

  const db = createServiceClient();
  const { data: communities, error } = await timer.measure("database", () =>
    callPerformanceRpc(db, "get_all_communities", {
      p_user_id: session.userId!,
    }),
  );

  if (error) {
    timer.finish({
      database_queries: 1,
      status: 500,
    });
    return NextResponse.json(
      { error: "Failed to fetch communities." },
      { status: 500 },
    );
  }

  const body = { communities: communities ?? [] };
  timer.finish({
    database_queries: 1,
    rows: body.communities.length,
    response_bytes: estimateJsonBytes(body),
    status: 200,
  });

  return NextResponse.json(body);
}
