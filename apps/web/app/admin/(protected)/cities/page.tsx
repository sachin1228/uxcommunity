import { MasterDataPageWithFetch } from "@/components/admin/masterData/MasterDataPageWithFetch";

export const metadata = { title: "Cities — Admin" };

export default function CitiesPage() {
  return (
    <MasterDataPageWithFetch
      title="Cities"
      entity="City"
      apiBase="/api/admin/cities"
      basePath="/admin/cities"
      fetchEntity="City"
      fetchTable="cities"
    />
  );
}
