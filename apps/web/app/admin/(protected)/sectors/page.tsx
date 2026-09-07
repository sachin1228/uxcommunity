import { MasterDataPageWithFetch } from "@/components/admin/masterData/MasterDataPageWithFetch";

export const metadata = { title: "Industry Sectors — Admin" };

export default function SectorsPage() {
  return (
    <MasterDataPageWithFetch
      title="Industry Sectors"
      entity="Sector"
      apiBase="/api/admin/sectors"
      basePath="/admin/sectors"
      fetchEntity="Sector"
      fetchTable="design_sectors"
    />
  );
}
