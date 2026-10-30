import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyAppealToken } from "@/lib/moderation/appeal-token";
import { reportReasonLabel } from "@/lib/communities/report-reasons";
import { AppealLinkForm } from "./AppealLinkForm";

export const metadata = {
  title: "Appeal a moderation decision — uxcommunity",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface RestrictedReport {
  id: string;
  target_type: string;
  target_author_id: string | null;
  status: string;
  reason: string;
  resolution_note: string | null;
  context_title: string | null;
  target_excerpt: string | null;
}

const TARGET_LABELS: Record<string, string> = {
  thread_comment: "comment",
  showcase_comment: "comment",
  resource_comment: "comment",
  event_comment: "comment",
  community_message: "chat message",
  profile: "profile",
  community: "community",
  job: "job listing",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
      {children}
    </main>
  );
}

/**
 * The page an emailed restriction link opens.
 *
 * The token proves the recipient is the account the decision was taken
 * against; the page never accepts a report id from the URL, and never shows
 * the reporter or any other member's data. The form posts the same token back
 * to the API, which re-verifies it.
 */
export default async function AppealLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await verifyAppealToken(token).catch(() => null);

  if (!payload) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h1 className="font-display text-lg font-semibold text-foreground">
            This appeal link is invalid or has expired
          </h1>
          <p className="mt-2 font-body text-xs leading-5 text-foreground-muted">
            Appeal links expire after 30 days and only work for the decision they
            were sent for. If you still need a review, contact
            hello@uxcommunity.in.
          </p>
        </div>
      </Shell>
    );
  }

  const db = createServiceClient();
  const { data: report } = await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select(
      "id, target_type, target_author_id, status, reason, resolution_note, context_title, target_excerpt",
    )
    .eq("id", payload.r)
    .maybeSingle();

  const restricted = report as unknown as RestrictedReport | null;
  if (!restricted || restricted.target_author_id !== payload.u) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h1 className="font-display text-lg font-semibold text-foreground">
            This appeal link is invalid
          </h1>
          <p className="mt-2 font-body text-xs text-foreground-muted">
            The decision it refers to is not available for this account.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: appeal } = await (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .select("id")
    .eq("report_id", restricted.id)
    .maybeSingle();

  const decision = [
    `A ${TARGET_LABELS[restricted.target_type] ?? "content"} decision was taken against your account.`,
    restricted.context_title ? `Target: ${restricted.context_title}.` : null,
    `Reason: ${reportReasonLabel(restricted.reason)}.`,
    restricted.resolution_note ? `Moderator note: ${restricted.resolution_note}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Shell>
      <p className="mb-4 text-center font-display text-xl font-semibold text-foreground">
        UXCommunity
      </p>
      <AppealLinkForm
        token={token}
        decision={decision}
        alreadyAppealed={Boolean(appeal)}
      />
      <p className="mt-4 text-center font-body text-[11px] text-foreground-subtle">
        This link is personal to your account. Do not share it.
      </p>
    </Shell>
  );
}
