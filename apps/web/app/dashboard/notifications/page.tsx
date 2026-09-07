import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { NotificationsView } from "./NotificationsView";

export const metadata = { title: "Notifications — uxcommunity" };

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  return <NotificationsView userId={session.userId!} />;
}
