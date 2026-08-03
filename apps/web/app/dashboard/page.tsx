import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { Globe } from "lucide-react";
import { HomeFeed } from "./HomeFeed";

export const metadata = { title: `Home — drafthub` };

export default async function DashboardPage() {
  const session = await getSession();
  const userId = session?.userId ?? "";

  const name = await (async () => {
    if (!session?.userId) return null;
    const db = createServiceClient();
    const { data } = await db.from("users").select("name").eq("id", session.userId).maybeSingle();
    return data?.name ?? null;
  })();

  return (
    <div className="flex gap-8 px-6 py-6 items-start">
      {/* ── Main feed ── */}
      <div className="w-full max-w-[600px] shrink-0">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-foreground mb-1">
            Welcome back{name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
          <p className="font-body text-sm text-foreground-muted">
            Your space to share work, connect with creatives, and discover new opportunities.
          </p>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Globe size={14} className="text-foreground-muted" />
          <h2 className="font-body text-sm font-semibold text-foreground">Public Feed</h2>
        </div>

        <HomeFeed currentUserId={userId} />
      </div>

      {/* ── Sidebar ── */}
      <aside className="hidden lg:block flex-1 sticky top-6">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
      </aside>
    </div>
  );
}
