import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { HomeComposer } from "./HomeComposer";
import { HomeFeed } from "./HomeFeed";

export const metadata = { title: "Home — uxcommunity" };

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
    <div className="flex items-stretch h-full">
      {/* ── Main feed — fills remaining space like community chat ── */}
      <div className="flex-1 min-w-0 border-r border-border">
        <div className="mb-6 p-6">
          <h1 className="font-display text-2xl font-semibold text-foreground mb-1">
            Welcome back{name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
        </div>

        <HomeComposer />
        <HomeFeed currentUserId={userId} />
      </div>

      {/* ── Sidebar ── */}
      <aside className="hidden lg:block w-72 shrink-0 sticky top-6 p-4">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
      </aside>
    </div>
  );
}
