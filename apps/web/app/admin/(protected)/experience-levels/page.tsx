import { MasterDataPageWithFetch } from "@/components/admin/masterData/MasterDataPageWithFetch";

export const metadata = { title: "Experience Levels — Admin" };

export default function ExperienceLevelsPage() {
  return (
    <MasterDataPageWithFetch
      title="Experience Levels"
      entity="Experience Level"
      apiBase="/api/admin/experience-levels"
      basePath="/admin/experience-levels"
      responseKey="experience_levels"
      fetchEntity="Experience Level"
      fetchTable="experience_levels"
    />
  );
}
