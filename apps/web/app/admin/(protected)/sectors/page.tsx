import { MasterDataPage } from "@/components/admin/MasterDataPage";

export const metadata = { title: "Industry Sectors — Admin" };

export default function SectorsPage() {
  return (
    <MasterDataPage
      title="Industry Sectors"
      entity="Sector"
      apiBase="/api/admin/sectors"
    />
  );
}
