import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { createServiceClient } from "@/lib/supabase/service";
import { embedLottieData } from "@/lib/communities/dp";

export async function GET() {
  const timer = createServerTimer("GET /api/communities/all");

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user", { verifyActive: false }));
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
    const databaseError = {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    };

    console.error("[GET /api/communities/all] Supabase RPC failed", {
      rpc: "get_all_communities",
      parameters: { p_user_id: session.userId! },
      error: databaseError,
    });

    timer.finish({
      database_queries: 1,
      status: 500,
    });
    return NextResponse.json(
      {
        error: "Failed to fetch communities.",
        database: databaseError,
      },
      { status: 500 },
    );
  }

  const rows = (communities ?? []) as Array<Record<string, unknown>>;

  // Embed lottie animation payloads for communities with an animated DP
  // (R2 is not browser-fetchable, so the data ships inline). Cached per URL.
  const enriched = await Promise.all(
    rows.map(async (community) => {
      if (community.lottie_url && community.lottie_format) {
        return {
          ...community,
          lottie_data: await embedLottieData(
            community.lottie_url as string,
            community.lottie_format as "json" | "dotlottie"
          ),
        };
      }
      return { ...community, lottie_data: null };
    })
  );

  const body = { communities: enriched };
  timer.finish({
    database_queries: 1,
    rows: body.communities.length,
    response_bytes: estimateJsonBytes(body),
    status: 200,
  });

  return NextResponse.json(body);
}
