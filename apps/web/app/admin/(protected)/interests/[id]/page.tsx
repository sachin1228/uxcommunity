import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "Interest — Admin" };

export default function InterestDetailPage() {
  return (
    <MasterItemDetail
      entity="Interest"
      apiBase="/api/admin/interests"
      listPath="/admin/interests"
      responseKey="interest"
    />
  );
}
