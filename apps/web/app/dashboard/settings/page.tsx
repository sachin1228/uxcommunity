import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ContactLinksCard } from "./ContactLinksCard";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name, email, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select("linkedin_url, portfolio_url")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  // The untyped Supabase client types these rows as `never`; cast once here.
  const userRow = (user ?? {}) as { email?: string; created_at?: string };
  const profileRow = (profile ?? {}) as { linkedin_url?: string; portfolio_url?: string };

  const memberSince = userRow.created_at
    ? new Date(userRow.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  return (
    <div className="mx-auto mt-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-0.5 font-body text-sm text-foreground-muted">
          Your contact details and links
        </p>
      </div>

      <ContactLinksCard
        email={userRow.email ?? session.email ?? ""}
        memberSince={memberSince}
        initialLinkedIn={profileRow.linkedin_url ?? ""}
        initialPortfolio={profileRow.portfolio_url ?? ""}
      />
    </div>
  );
}
