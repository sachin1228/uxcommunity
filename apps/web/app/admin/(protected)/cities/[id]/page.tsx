import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "City — Admin" };

export default function CityDetailPage() {
  return (
    <MasterItemDetail
      entity="City"
      apiBase="/api/admin/cities"
      listPath="/admin/cities"
      responseKey="city"
    />
  );
}
