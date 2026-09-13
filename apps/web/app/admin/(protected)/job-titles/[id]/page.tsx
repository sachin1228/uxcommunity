import { MasterItemDetail } from "@/components/admin/MasterItemDetail";

export const metadata = { title: "Job Title — Admin" };

export default function JobTitleDetailPage() {
  return (
    <MasterItemDetail
      entity="Job Title"
      apiBase="/api/admin/job-titles"
      listPath="/admin/job-titles"
      responseKey="job_title"
    />
  );
}
