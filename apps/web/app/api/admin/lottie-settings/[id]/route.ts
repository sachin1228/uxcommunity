import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }

  const { id } = await params;
  const db = createServiceClient();

  const { error } = await db.from("lottie_settings").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Failed to delete lottie setting." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
