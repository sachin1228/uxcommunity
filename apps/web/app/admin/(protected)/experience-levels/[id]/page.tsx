import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "Experience Level — Admin" };

export default function ExperienceLevelDetailPage() {
  return (
    <MasterItemDetail
      entity="Experience Level"
      apiBase="/api/admin/experience-levels"
      listPath="/admin/experience-levels"
      responseKey="experience_level"
    />
  );
}
