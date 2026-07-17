import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  if (session.role === "admin") {
    return NextResponse.json({ user: { role: "admin", email: session.email } });
  }

  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select("id, name, email")
    .eq("id", session.userId!)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Check if profile is complete
  const { data: profile } = await db
    .from("designer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    user: {
      ...user,
      role: "user",
      profileComplete: !!profile,
    },
  });
}
