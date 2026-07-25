// Communities sub-layout.
// The global sidebar (in DashboardLayout) already renders the community list
// and the Explore Communities link, so this layout only needs to make the
// content area fill the available height for the chat / explore pages.

export default function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {children}
    </div>
  );
}
