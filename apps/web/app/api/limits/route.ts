import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCreationUsage } from "@/lib/creation-usage";

/**
 * The member's own creation-budget usage, for the header's limits ring.
 *
 * Read-only and personal: the numbers come from the same tables the creation
 * triggers read, and the budgets themselves from `public.creation_limits`.
 * Nothing here enforces anything — a write is still refused by the database.
 */
export async function GET() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const usage = await loadCreationUsage(createServiceClient(), session.userId!);
  return NextResponse.json(usage);
}
