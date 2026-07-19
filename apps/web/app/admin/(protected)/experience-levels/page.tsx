import { MasterDataPage } from "@/components/admin/MasterDataPage";

export const metadata = { title: "Experience Levels — Admin" };

export default function ExperienceLevelsPage() {
  return (
    <MasterDataPage
      title="Experience Levels"
      entity="Experience Level"
      apiBase="/api/admin/experience-levels"
      basePath="/admin/experience-levels"
      responseKey="experience_levels"
      readOnly
    />
  );
}
