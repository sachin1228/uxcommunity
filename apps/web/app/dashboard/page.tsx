import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata = { title: `Dashboard — drafthub` };

export default async function DashboardPage() {
  // Fetch name in parallel with the layout's own queries — both use the
  // service client so there is no serial waterfall between layout and page.
  const session = await getSession();
  const name = await (async () => {
    if (!session?.userId) return null;
    const db = createServiceClient();
    const { data } = await db
      .from("users")
      .select("name")
      .eq("id", session.userId)
      .maybeSingle();
    return data?.name ?? null;
  })();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-1">
        Welcome back{name ? `, ${name.split(" ")[0]}` : ""}
      </h1>
      <p className="font-body text-sm text-foreground-muted">
        Your space to share work, connect with creatives, and discover new opportunities.
      </p>
    </div>
  );
}
