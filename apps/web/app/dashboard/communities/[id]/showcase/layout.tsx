import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CommunityPageShell } from "@/components/communities/CommunityPageShell";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/** Wraps showcase detail pages in the standard community header and tabs. */
export default async function ShowcaseLayout({ children, params }: Props) {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const { id } = await params;
  const userId = (session as { userId: string }).userId;

  return (
    <CommunityPageShell communityId={id} activeTab="showcase" currentUserId={userId}>
      {children}
    </CommunityPageShell>
  );
}
