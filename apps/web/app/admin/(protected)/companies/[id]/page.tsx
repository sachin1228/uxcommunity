import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "Company — Admin" };

export default function CompanyDetailPage() {
  return (
    <MasterItemDetail
      entity="Company"
      apiBase="/api/admin/companies"
      listPath="/admin/companies"
      responseKey="company"
    />
  );
}
