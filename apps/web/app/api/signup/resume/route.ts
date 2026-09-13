import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/signup/resume?token=…
 *
 * Public (the signup page has no session) — validates a resume link and returns
 * the name/email to prefill. The member still chooses a password on step 1;
 * passwords are never stored, so the link cannot sign anyone in by itself.
 *
 * A link stops working the moment the attempt is marked completed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false, error: "Token is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: attempt, error } = (await db
    .from("signup_attempts")
    .select("name, email, status, resume_token_expires_at")
    .eq("resume_token", token)
    .maybeSingle()) as unknown as {
      data: {
        name: string | null;
        email: string;
        status: "started" | "completed";
        resume_token_expires_at: string | null;
      } | null;
      error: unknown;
    };

  if (error) {
    console.error("[signup/resume] lookup error:", error);
    return NextResponse.json(
      { valid: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  if (!attempt) {
    return NextResponse.json(
      { valid: false, error: "This link is invalid. Please start signup again." },
      { status: 404 }
    );
  }
  if (attempt.status !== "started") {
    return NextResponse.json(
      { valid: false, error: "This signup has already been completed." },
      { status: 410 }
    );
  }
  if (!attempt.resume_token_expires_at || new Date(attempt.resume_token_expires_at) < new Date()) {
    return NextResponse.json(
      { valid: false, error: "This link has expired. Please start signup again." },
      { status: 410 }
    );
  }

  return NextResponse.json({
    valid: true,
    name: attempt.name ?? "",
    email: attempt.email,
  });
}
