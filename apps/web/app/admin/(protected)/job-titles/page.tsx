import { MasterDataPageWithFetch } from "@/components/admin/masterData/MasterDataPageWithFetch";

export const metadata = { title: "Job Titles — Admin" };

export default function JobTitlesPage() {
  return (
    <MasterDataPageWithFetch
      title="Job Titles"
      entity="Job Title"
      apiBase="/api/admin/job-titles"
      basePath="/admin/job-titles"
      responseKey="job_titles"
      fetchEntity="Job Title"
      fetchTable="job_titles"
    />
  );
}
