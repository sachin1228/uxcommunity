import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  APPEAL_DAILY_LIMIT,
  APPEAL_MESSAGE_MAX_LENGTH,
  appealBlockedMessage,
  validateAppeal,
} from "@/lib/moderation/appeals";
import { verifyAppealToken } from "@/lib/moderation/appeal-token";

interface TokenReport {
  id: string;
  target_type: string;
  target_id: string;
  target_author_id: string | null;
  status: string;
}

/**
 * Submit an appeal from a signed email link.
 *
 * A banned or suspended member has no session, so this endpoint trusts the
 * HMAC-signed, expiring, report-scoped token instead. It still checks that the
 * report belongs to the account the token names and that the decision is
 * appealable, and the one-appeal-per-report unique index is the final gate.
 */
export async function POST(request: NextRequest) {
  // The form is served by this app; a cross-site POST is refused before any
  // token or message is processed. Requests from non-browser clients carry no
  // Origin header and are allowed through to the token check.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== request.nextUrl.host) {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }

  const body = (await request.json().catch(() => null)) as
    | { token?: string; message?: string }
    | null;
  const token = typeof body?.token === "string" ? body.token : "";
  const message = typeof body?.message === "string" ? body.message : "";

  if (message.length > APPEAL_MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { error: appealBlockedMessage("message_too_long") },
      { status: 422 },
    );
  }

  const payload = await verifyAppealToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: "This appeal link is invalid or has expired." },
      { status: 401 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const [ipLimit, userLimit] = await Promise.all([
    rateLimit(`moderation-appeal-token:${ip}`, 10, 3600),
    rateLimit(`moderation-appeal:${payload.u}`, APPEAL_DAILY_LIMIT, 86400),
  ]);
  if (!ipLimit.success || !userLimit.success) {
    return NextResponse.json(
      { error: "Too many appeals. Please try again later." },
      { status: 429 },
    );
  }

  const db = createServiceClient();
  const { data: report } = (await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select("id, target_type, target_id, target_author_id, status")
    .eq("id", payload.r)
    .maybeSingle()) as { data: TokenReport | null };

  if (!report) {
    return NextResponse.json({ error: "This decision is no longer available." }, { status: 404 });
  }

  // The token names the account; the report must agree. A token cannot be
  // replayed against another member's decision.
  if (report.target_author_id !== payload.u) {
    return NextResponse.json({ error: "This appeal link is invalid." }, { status: 401 });
  }

  const eligibility = validateAppeal(
    { status: report.status, targetAuthorId: report.target_author_id },
    payload.u,
    message,
  );
  if (!eligibility.allowed) {
    return NextResponse.json(
      { error: appealBlockedMessage(eligibility.reason) },
      { status: 422 },
    );
  }

  const { error } = await (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .insert({
      report_id: report.id,
      user_id: payload.u,
      target_type: report.target_type,
      target_id: report.target_id,
      message: message.trim(),
    });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You have already appealed this decision." },
        { status: 409 },
      );
    }
    console.error("[moderation/appeals/token] insert failed:", error);
    return NextResponse.json({ error: "Failed to submit your appeal." }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
