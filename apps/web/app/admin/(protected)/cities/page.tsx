import { MasterDataPage } from "@/components/admin/MasterDataPage";

export const metadata = { title: "Cities — Admin" };

export default function CitiesPage() {
  return (
    <MasterDataPage
      title="Cities"
      entity="City"
      apiBase="/api/admin/cities"
    />
  );
}
