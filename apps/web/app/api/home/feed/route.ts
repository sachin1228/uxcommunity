import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";

const PAGE_SIZE = 30;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/home/feed");
  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user"));
  } catch (error) {
    timer.finish({ status: (error as Response).status ?? 401 });
    return error as Response;
  }

  const before = req.nextUrl.searchParams.get("before");
  if (before && Number.isNaN(Date.parse(before))) {
    timer.finish({ status: 400 });
    return NextResponse.json(
      { error: "Invalid feed cursor." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data, error } = await timer.measure("feed_page_rpc", () =>
    callPerformanceRpc(createServiceClient(), "get_home_feed_page", {
      p_user_id: session.userId!,
      p_before: before,
      p_limit: PAGE_SIZE,
    }),
  );

  if (error) {
    console.error("[GET home feed]", error);
    timer.finish({ status: 500 });
    return NextResponse.json(
      { error: "Failed to load the latest posts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const items = (data ?? []).map(({ item }) => item);
  const body = { items };
  timer.finish({
    status: 200,
    query_count: 1,
    returned_rows: items.length,
    response_bytes: estimateJsonBytes(body),
  });

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
