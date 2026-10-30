import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AppealsView } from "./AppealsView";

export const metadata = { title: "Moderation appeals — uxcommunity" };

export default async function AppealsPage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  return (
    <div className="px-4 py-6 lg:px-8">
      <AppealsView />
    </div>
  );
}
