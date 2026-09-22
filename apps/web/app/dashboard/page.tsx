import { getSession } from "@/lib/auth/session";
import { DashboardHome } from "./DashboardHome";
import { HomeRail } from "./HomeRail";

export const metadata = { title: "Home — uxcommunity" };

export default async function DashboardPage() {
  const session = await getSession();
  const userId = session?.userId ?? "";

  return <DashboardHome userId={userId} rail={<HomeRail userId={userId} />} />;
}
