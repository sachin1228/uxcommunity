import { NextRequest, NextResponse } from "next/server";
import {
  invalidateUserLiveness,
  requireSession,
} from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification } from "@/lib/notifications";

interface ReviewRow {
  user_id: string;
  verification_status: "approved" | "rejected";
  reapply_at: string | null;
  user_name: string | null;
  user_email: string;
  rejection_reason: string | null;
}

function reapplyLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** PATCH /api/admin/verifications/[id] { action: "approve" | "reject", reason? } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  let body: { action?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; reason?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = body.action;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Choose approve or reject." }, { status: 422 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const db = createServiceClient();
  const { data, error } = await (db as any).rpc("review_account_verification", {
    p_request_id: id,
    p_action: action,
    p_reason: reason || null,
    p_reviewed_by: session.email,
  });

  if (error) {
    const message = String(error.message ?? "");
    if (message.includes("request_not_pending")) {
      return NextResponse.json({ error: "This request has already been reviewed." }, { status: 409 });
    }
    if (message.includes("reason_required")) {
      return NextResponse.json({ error: "Add a rejection reason (at least 5 characters)." }, { status: 422 });
    }
    console.error("[admin/verifications] review error:", error);
    return NextResponse.json({ error: "Failed to review this request." }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as ReviewRow | null;
  if (!row) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  invalidateUserLiveness(row.user_id);

  const approved = row.verification_status === "approved";
  const title = approved ? "Your account is verified" : "Verification not approved";
  const bodyText = approved
    ? "You now have full access to post, message, join communities, and apply to jobs."
    : `Reason: ${row.rejection_reason ?? reason}${
        row.reapply_at ? ` You can reapply from ${reapplyLabel(row.reapply_at)}.` : ""
      }`;

  const notification = await createNotification(db, {
    userId: row.user_id,
    actorId: null,
    type: approved ? "verification_approved" : "verification_rejected",
    entityType: "verification",
    entityId: id,
    title,
    body: bodyText,
    href: "/dashboard/verification",
  });
  if (!notification.ok) {
    console.error("[admin/verifications] notification error:", notification.error);
  }

  return NextResponse.json({
    success: true,
    status: row.verification_status,
    reapplyAt: row.reapply_at,
  });
}
