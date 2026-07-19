import { CommunitiesPanel } from "@/components/communities/CommunitiesPanel";

export default function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-8 -my-8 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>
      <CommunitiesPanel />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
