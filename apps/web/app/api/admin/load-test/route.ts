import { NextRequest } from "next/server";
import { handlePost } from "./impl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  return handlePost(req);
}
