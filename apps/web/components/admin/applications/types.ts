// ─── Shared types & constants for the Applications admin section ─────────────

export interface AppTag {
  tag_id: string;
  tags: { id: string; name: string };
}

export interface Application {
  id: string;
  name: string;
  email: string;
  linkedin_url: string;
  portfolio_url: string;
  status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  applicant_email: string;
  created_at: string;
  application_tags: AppTag[];
}

export interface HistoryItem {
  id: string;
  status: string;
  linkedin_url: string;
  portfolio_url: string;
  review_notes: string | null;
  created_at: string;
}

export interface TagItem {
  id: string;
  name: string;
}

export type StatusFilter = "all" | "pending" | "approved" | "rejected";

export const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all",      label: "All"      },
  { value: "pending",  label: "Pending"  },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export const STATUS_COLORS: Record<string, string> = {
  pending:  "bg-yellow-500/10 text-yellow-400",
  approved: "bg-green-500/10 text-green-400",
  rejected: "bg-red-500/10  text-red-400",
};
