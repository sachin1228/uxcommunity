import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadNotificationPreferences } from "@/lib/settings/load";
import { NotificationsSection } from "../NotificationsSection";
import { SettingsBackLink } from "../SettingsBackLink";

export const metadata = { title: "Notifications — Settings" };

/** Notifications drill-down: the chat push switches and quiet hours. */
export default async function NotificationSettingsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { push } = await loadNotificationPreferences(session.userId!);

  return (
    <>
      <SettingsBackLink />
      <div className="mt-4">
        <NotificationsSection initial={push} />
      </div>
    </>
  );
}
