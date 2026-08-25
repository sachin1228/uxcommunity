import { Spinner } from "@/components/ui/Spinner";

/** Dashboard home loading boundary — only the centered feed spinner is shown. */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading homepage">
      <Spinner size={28} />
    </div>
  );
}
