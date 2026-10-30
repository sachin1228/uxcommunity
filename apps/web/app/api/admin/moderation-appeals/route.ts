import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

const PAGE_SIZE = 25;
const STATUS_VALUES = new Set(["pending", "granted", "denied", "all"]);

interface AppealRow {
  id: string;
  report_id: string;
  user_id: string | null;
  target_type: string;
  target_id: string;
  message: string;
  status: "pending" | "granted" | "denied";
  resolution_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * Appeals filed by moderated members. The queue joins each appeal to its
 * report's evidence snapshot so a reviewer can decide without opening the
 * (possibly deleted) target.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;
  const requestedStatus = searchParams.get("status") ?? "pending";
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : "pending";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  let query = (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .select("*", { count: "exact" });
  if (status !== "all") query = query.eq("status", status);

  const { data, error, count } = (await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)) as {
    data: AppealRow[] | null;
    error: unknown;
    count: number | null;
  };

  if (error) {
    console.error("[admin/moderation-appeals] read failed:", error);
    return NextResponse.json({ error: "Failed to fetch appeals." }, { status: 500 });
  }

  const appeals = data ?? [];
  const reportIds = [...new Set(appeals.map((appeal) => appeal.report_id))];
  const userIds = [
    ...new Set(
      appeals
        .map((appeal) => appeal.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [{ data: reports }, { data: users }] = await Promise.all([
    reportIds.length
      ? (db as unknown as SupabaseClient)
          .from("interaction_reports")
          .select(
            "id, reporter_id, target_type, target_id, context_id, community_id, target_author_id, target_excerpt, context_title, reason, details, status, resolution_note, target_snapshot, resolved_at",
          )
          .in("id", reportIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? (db as unknown as SupabaseClient)
          .from("users")
          .select("id, name, is_blocked, suspended_until")
          .in("id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const reportById = new Map(
    ((reports ?? []) as Array<{ id: string }>).map((report) => [report.id, report]),
  );
  const userById = new Map(
    ((users ?? []) as Array<{ id: string; name: string | null }>).map((user) => [
      user.id,
      user,
    ]),
  );

  return NextResponse.json({
    appeals: appeals.map((appeal) => {
      const user = appeal.user_id ? userById.get(appeal.user_id) : undefined;
      return {
        ...appeal,
        user_name: user?.name ?? (appeal.user_id ? "Member" : "Deleted user"),
        is_blocked: (user as { is_blocked?: boolean } | undefined)?.is_blocked ?? false,
        suspended_until:
          (user as { suspended_until?: string | null } | undefined)?.suspended_until ?? null,
        report: reportById.get(appeal.report_id) ?? null,
      };
    }),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  });
}
