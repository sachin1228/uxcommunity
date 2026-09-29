import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { leaveCompany } from "@/lib/companies/service";

/**
 * Removes the company from the member's profile.
 *
 * The session decides whose membership this is, and the database deletes the
 * membership row and clears the profile pointer together. Nothing about the
 * company or its verified domain is touched, so colleagues who proved the same
 * domain keep their membership.
 */
export async function DELETE() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }

  const result = await leaveCompany(createServiceClient(), session.userId!);

  if (!result.ok) {
    return NextResponse.json(
      { error: "leave_failed", message: "Couldn't update your profile. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ removed: result.removed });
}
