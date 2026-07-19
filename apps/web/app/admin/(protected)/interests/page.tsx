import { MasterDataPage } from "@/components/admin/MasterDataPage";

export const metadata = { title: "Interests — Admin" };

export default function InterestsPage() {
  return (
    <MasterDataPage
      title="Design Interests"
      entity="Interest"
      apiBase="/api/admin/interests"
      basePath="/admin/interests"
    />
  );
}
