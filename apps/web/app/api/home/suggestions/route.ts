import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getHomeRailData } from "@/lib/home/home-sidebar-server";
import { createServerTimer } from "@/lib/server-timing";

export async function GET() {
  const timer = createServerTimer("GET /api/home/suggestions");
  try {
    const session = await timer.measure("auth", () => requireSession("user", { allowUnverified: true }));
    const body = await timer.measure("suggestions", () => getHomeRailData(session.userId!));
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store", "Server-Timing": timer.finish({ status: 200 }) } });
  } catch (error) {
    const response = error instanceof Response ? error : NextResponse.json({ error: "Suggestions are temporarily unavailable." }, { status: 500 });
    response.headers.set("Server-Timing", timer.finish({ status: response.status }));
    return response;
  }
}
