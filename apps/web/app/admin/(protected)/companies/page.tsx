import { MasterDataPage } from "@/components/admin/MasterDataPage";

export const metadata = { title: "Companies — Admin" };

export default function CompaniesPage() {
  return (
    <MasterDataPage
      title="Companies"
      entity="Company"
      apiBase="/api/admin/companies"
      basePath="/admin/companies"
    />
  );
}
