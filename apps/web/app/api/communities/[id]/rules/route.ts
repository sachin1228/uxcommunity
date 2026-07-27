import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

// ── GET /api/communities/[id]/rules ─────────────────────────────────────────
// Returns rules for the community ordered by order_index.
// Any logged-in member can read rules.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession(); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const { data, error } = await db
    .from("community_rules")
    .select("id, rule_text, order_index")
    .eq("community_id", id)
    .order("order_index", { ascending: true });

  if (error) return NextResponse.json({ error: "Failed to load rules." }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}
