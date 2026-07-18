import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "Industry Sector — Admin" };

export default function SectorDetailPage() {
  return (
    <MasterItemDetail
      entity="Sector"
      apiBase="/api/admin/sectors"
      listPath="/admin/sectors"
      responseKey="sector"
    />
  );
}
