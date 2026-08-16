import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient, getDuelView } from "@/lib/design-duel/server-data";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { DuelPage } from "@/components/design-duel/DuelPage";

export const metadata = { title: "Design Duel — uxcommunity" };

export const dynamic = "force-dynamic";

export default async function DuelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const userId = session?.userId ?? "";
  const duelId = (await params).id;
  const db = createServiceClient();

  const { data: duel } = await db
    .from("design_duels")
    .select("id, status")
    .eq("id", duelId)
    .maybeSingle();

  if (!duel) notFound();

  if (duel.status === "open") {
    try {
      await callPerformanceRpc(db, "resolve_duel", { p_duel_id: duelId });
    } catch (error) {
      console.error("[design duel resolve]", error);
    }
  }

  const view = await getDuelView(db, duelId, userId);
  if (!view) notFound();

  return <DuelPage initialDuel={view} />;
}