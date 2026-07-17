import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applicationSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/auth/rate-limit";

export async function POST(request: NextRequest) {
  // Rate limit: 5 submissions per IP per hour
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`apply:${ip}`, 5, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = applicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name, email, linkedin_url, portfolio_url } = parsed.data;
  const db = createServiceClient();

  // Check for existing pending application
  const { data: pending } = await db
    .from("applications")
    .select("id, status")
    .eq("applicant_email", email.toLowerCase())
    .eq("status", "pending")
    .maybeSingle();

  if (pending) {
    return NextResponse.json(
      { error: "Your application is already under review." },
      { status: 409 }
    );
  }

  // Check if already an approved user
  const { data: approvedApp } = await db
    .from("applications")
    .select("id, status")
    .eq("applicant_email", email.toLowerCase())
    .eq("status", "approved")
    .maybeSingle();

  if (approvedApp) {
    return NextResponse.json(
      {
        error:
          "An account already exists for this email. Please log in instead.",
        redirect: "/",
      },
      { status: 409 }
    );
  }

  // Insert application
  const { data: application, error } = await db
    .from("applications")
    .insert({
      name,
      email: email.toLowerCase(),
      linkedin_url,
      portfolio_url,
      applicant_email: email.toLowerCase(),
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[apply] insert error:", error);
    return NextResponse.json(
      { error: "Failed to submit application. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      message:
        "Thanks for applying. We'll review your portfolio and send you an invitation if you're approved.",
      applicationId: application.id,
    },
    { status: 201 }
  );
}
