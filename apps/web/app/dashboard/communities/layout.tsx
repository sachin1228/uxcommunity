import { getSession } from "@/lib/auth/session";
import { CommunitiesPanel } from "@/components/communities/CommunitiesPanel";

export default async function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const userId = (session as { userId?: string } | null)?.userId ?? "";

  return (
    <div className="-mx-8 -my-8 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>
      <CommunitiesPanel userId={userId} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
