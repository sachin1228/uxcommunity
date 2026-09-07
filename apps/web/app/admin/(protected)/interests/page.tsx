import { MasterDataPageWithFetch } from "@/components/admin/masterData/MasterDataPageWithFetch";

export const metadata = { title: "Interests — Admin" };

export default function InterestsPage() {
  return (
    <MasterDataPageWithFetch
      title="Design Interests"
      entity="Interest"
      apiBase="/api/admin/interests"
      basePath="/admin/interests"
      fetchEntity="Interest"
      fetchTable="design_interests"
    />
  );
}
