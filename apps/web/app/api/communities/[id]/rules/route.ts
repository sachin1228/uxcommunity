import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityRules } from "@/lib/communities/read-models";

// ── GET /api/communities/[id]/rules ─────────────────────────────────────────
// Returns rules for the community ordered by order_index.
// Any logged-in member can read rules. Served through the same cached loader
// the chat bootstrap uses, so the info panel and the bootstrap's rules section
// agree and a rule edit clears both at once (admin routes revalidate the tag).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession(undefined, { verifyActive: false }); } catch (e) { return e as Response; }
  const { id } = await params;

  const result = await loadCommunityRules(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
