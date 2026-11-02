import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  DEFAULT_VERIFICATION_GRACE_DAYS,
  invalidateVerificationGraceCache,
  MAX_VERIFICATION_GRACE_DAYS,
} from "@/lib/verification/settings";

/** GET /api/admin/verification-settings — the configured grace windows. */
export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("verification_settings")
    .select("grace_days, new_account_grace_days")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("[admin/verification-settings] GET error:", error);
    return NextResponse.json({ error: "Failed to load the setting." }, { status: 500 });
  }

  const row = data as { grace_days?: number; new_account_grace_days?: number } | null;
  return NextResponse.json({
    graceDays: row?.grace_days ?? DEFAULT_VERIFICATION_GRACE_DAYS,
    newAccountGraceDays: row?.new_account_grace_days ?? DEFAULT_VERIFICATION_GRACE_DAYS,
    maxDays: MAX_VERIFICATION_GRACE_DAYS,
  });
}

/** PATCH /api/admin/verification-settings { scope: "legacy" | "new", days: 0–30 } */
export async function PATCH(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  let scope: unknown;
  let days: unknown;
  try {
    const body = (await request.json()) as { scope?: unknown; days?: unknown };
    scope = body.scope;
    days = body.days;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (scope !== "legacy" && scope !== "new") {
    return NextResponse.json({ error: "Choose the legacy or new-account grace." }, { status: 422 });
  }

  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 0 ||
    days > MAX_VERIFICATION_GRACE_DAYS
  ) {
    return NextResponse.json(
      { error: `Choose between 0 and ${MAX_VERIFICATION_GRACE_DAYS} days.` },
      { status: 422 },
    );
  }

  const db = createServiceClient();
  const saving = new Date().toISOString();
  const { error } =
    scope === "legacy"
      ? await db
          .from("verification_settings")
          .upsert({ id: true, grace_days: days, updated_at: saving }, { onConflict: "id" })
      : await db
          .from("verification_settings")
          .upsert(
            { id: true, new_account_grace_days: days, updated_at: saving },
            { onConflict: "id" },
          );

  if (error) {
    console.error("[admin/verification-settings] PATCH error:", error);
    return NextResponse.json({ error: "Failed to save the setting." }, { status: 500 });
  }

  if (scope === "new") invalidateVerificationGraceCache();
  return NextResponse.json({ success: true, scope, days });
}
