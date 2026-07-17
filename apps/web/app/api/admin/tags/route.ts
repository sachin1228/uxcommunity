import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function GET() {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("tags")
    .select("id, name")
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Failed to fetch tags" }, { status: 500 });
  }

  return NextResponse.json({ tags: data });
}
