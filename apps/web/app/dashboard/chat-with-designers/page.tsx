import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DesignersRoomView } from "@/components/designers/DesignersRoom";

export const metadata = {
  title: "Chat with designers",
};

export default async function ChatWithDesignersPage() {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select("name")
    .eq("id", session.userId!)
    .maybeSingle();

  const name = (user as { name?: string | null } | null)?.name;

  return (
    <div className="h-full">
      <DesignersRoomView
        userId={session.userId!}
        userName={name ?? session.email ?? "Designer"}
      />
    </div>
  );
}
