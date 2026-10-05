"use client";

// Admin view of one reported post: everything the queue row cannot show.
// Admins cannot open member-side post pages (those redirect non-"user"
// roles), so this page IS the "view post": the full content preview —
// title, body, media, poll, event details, live engagement counts — plus the
// reported-by list and the takedown/undo controls. The author and community
// link out to the existing admin profile and community pages.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Flag,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { showUndoToast } from "@/lib/undo-toast";
import {
  REPORT_CONTENT_LABELS,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";

type ReportStatus = "pending" | "removed" | "dismissed";

interface DetailPerson {
  id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
}

interface DetailReport {
  id: string;
  reason: string;
  reason_label: string;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  reporter: DetailPerson | null;
}

interface DetailContent {
  type: ReportableContentType;
  id: string;
  exists: boolean;
  from_snapshot: boolean;
  title: string | null;
  description: string | null;
  created_at: string | null;
  is_public: boolean | null;
  category: string | null;
  tags: string[];
  links: string[];
  url: string | null;
  resource_type: string | null;
  image_url: string | null;
  cover_image_url: string | null;
  attachments: Array<{ url: string; type: string; name: string | null; poster: string | null }>;
  poll: { question: string; options: string[] } | null;
  event: {
    event_date: string | null;
    end_date: string | null;
    location: string | null;
    meet_link: string | null;
    is_online: boolean | null;
    max_attendees: number | null;
  } | null;
  stats: Record<string, number>;
}

interface DetailResponse {
  content: DetailContent;
  author: DetailPerson | null;
  community: { id: string; name: string } | null;
  reports: DetailReport[];
  counts: { total: number; pending: number; removed: number; dismissed: number; reporters: number };
  removal: {
    id: string;
    removed_at: string;
    removed_by: string | null;
    removed_by_name: string | null;
    undone_at: string | null;
  } | null;
}

const STATUS_STYLES: Record<ReportStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  removed: "bg-red-500/10 text-red-400",
  dismissed: "bg-surface-raised text-foreground-muted",
};

const STAT_LABELS: Record<string, string> = {
  comments: "Comments",
  likes: "Likes",
  saves: "Saves",
  bookmarks: "Bookmarks",
  rsvps: "RSVPs",
};

function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium capitalize ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-border-subtle py-2.5 last:border-0">
      <span className="w-32 shrink-0 font-body text-xs text-foreground-muted">{label}</span>
      <span className="min-w-0 flex-1 font-body text-xs text-foreground">{children}</span>
    </div>
  );
}

export default function AdminReportDetailPage() {
  const { contentType, contentId } = useParams<{ contentType: string; contentId: string }>();
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const actionUrl = `/api/admin/reports/${contentType}/${contentId}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(actionUrl);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      setDetail(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [actionUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function postAction(action: string, extra?: Record<string, unknown>) {
    const res = await fetch(actionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error ?? "Action failed.");
    return payload;
  }

  async function dismissReports(reportIds?: string[]) {
    setBusy("dismiss");
    setActionError(null);
    try {
      const payload = await postAction("dismiss", reportIds ? { reportIds } : undefined);
      await load();
      const dismissedIds: string[] = payload?.dismissedReportIds ?? [];
      if (dismissedIds.length) {
        showUndoToast({
          message: `Dismissed ${dismissedIds.length} report${dismissedIds.length === 1 ? "" : "s"}.`,
          onAction: async () => {
            await postAction("reopen", { reportIds: dismissedIds });
            await load();
          },
        });
      }
    } catch {
      setActionError("Failed to dismiss the reports.");
    } finally {
      setBusy(null);
    }
  }

  async function removePost() {
    setBusy("remove");
    setActionError(null);
    try {
      const payload = await postAction("remove");
      await load();
      if (payload?.removed) {
        showUndoToast({
          message: "Post removed — the author and reporters were notified.",
          onAction: async () => {
            await postAction("restore");
            await load();
          },
        });
      }
    } catch {
      setActionError("Failed to remove the post.");
    } finally {
      setBusy(null);
    }
  }

  async function restorePost() {
    setBusy("restore");
    setActionError(null);
    try {
      await postAction("restore");
      await load();
    } catch {
      setActionError("Failed to restore the post.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-4 w-4" />
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="py-16 text-center">
        <Flag strokeWidth={2.5} size={20} className="mx-auto mb-2 text-foreground-muted opacity-50" />
        <p className="font-body text-xs text-foreground-muted">
          This reported post could not be found.
        </p>
        <Link
          href="/admin/reports"
          className="mt-3 inline-flex items-center gap-1 font-body text-xs text-accent hover:underline"
        >
          <ArrowLeft strokeWidth={2.5} size={12} /> Back to reports
        </Link>
      </div>
    );
  }

  const { content, author, community, reports, counts, removal } = detail;
  const canRestore = Boolean(removal && !content.exists);

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link
          href="/admin/reports"
          className="inline-flex items-center gap-1 font-body text-xs text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft strokeWidth={2.5} size={12} /> Reports
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground-muted">
                {REPORT_CONTENT_LABELS[content.type]}
              </span>
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                {counts.total} report{counts.total === 1 ? "" : "s"}
              </span>
              {!content.exists && (
                <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
                  removed
                </span>
              )}
            </div>
            <h1 className="mt-1.5 font-display text-xl font-semibold text-foreground">
              {content.title || `(untitled ${REPORT_CONTENT_LABELS[content.type]})`}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {counts.pending > 0 && (
              <>
                <button
                  onClick={() => void dismissReports()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                >
                  {busy === "dismiss" && <Spinner size={12} />}
                  Dismiss all
                </button>
                <button
                  onClick={() => setConfirmRemove(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1.5 font-body text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                >
                  {busy === "remove" ? <Spinner size={12} /> : <Trash2 strokeWidth={2.5} size={12} />}
                  Delete post
                </button>
              </>
            )}
            {canRestore && (
              <button
                onClick={() => void restorePost()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1.5 font-body text-xs text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === "restore" ? <Spinner size={12} /> : <RotateCcw strokeWidth={2.5} size={12} />}
                Restore post
              </button>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {actionError}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* Content preview */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h2 className="font-display text-sm font-semibold text-foreground">Reported content</h2>
            <p className="mt-0.5 font-body text-xs text-foreground-muted">
              {content.exists
                ? "This is the live post, exactly as members see it."
                : content.from_snapshot
                  ? "This post was removed — the preview is reconstructed from its removal snapshot."
                  : "This post is no longer available."}
            </p>
          </div>

          {!content.exists && (
            <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-5 py-2.5">
              <Trash2 strokeWidth={2.5} size={13} className="shrink-0 text-red-400" />
              <p className="font-body text-xs text-red-400">
                This {REPORT_CONTENT_LABELS[content.type]} is removed
                {removal
                  ? ` (${removal.removed_by_name ? `by ${removal.removed_by_name}, ` : ""}${formatDateTime(removal.removed_at)})`
                  : ""}
                .{canRestore && " Restore it to put the post back and re-open its reports."}
              </p>
            </div>
          )}

          {(content.image_url || content.cover_image_url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={content.image_url ?? content.cover_image_url ?? ""}
              alt=""
              className="max-h-72 w-full border-b border-border object-cover"
            />
          )}

          <div className="px-5 py-2">
            <MetaRow label="Author">
              {author ? (
                <Link
                  href={`/admin/users/${author.id}`}
                  className="inline-flex items-center gap-2 text-foreground-muted hover:text-accent hover:underline"
                >
                  <AvatarImg url={author.avatar_url} name={author.name} size={22} className="h-[22px] w-[22px] rounded-full object-cover" />
                  {author.name}
                  {author.email && <span className="text-foreground-subtle">· {author.email}</span>}
                </Link>
              ) : (
                <span className="text-foreground-subtle">Unknown member</span>
              )}
            </MetaRow>

            <MetaRow label="Community">
              {community ? (
                <Link
                  href={`/admin/communities/${community.id}`}
                  className="text-foreground-muted hover:text-accent hover:underline"
                >
                  {community.name}
                </Link>
              ) : (
                <span className="text-foreground-subtle">Public feed</span>
              )}
            </MetaRow>

            {content.created_at && (
              <MetaRow label="Posted">
                <span className="text-foreground-muted">{formatDateTime(content.created_at)}</span>
              </MetaRow>
            )}

            <MetaRow label="Visibility">
              <span className="text-foreground-muted">
                {content.is_public === null ? "—" : content.is_public ? "Public" : "Community only"}
              </span>
            </MetaRow>

            {content.category && (
              <MetaRow label="Category">
                <span className="text-foreground-muted">{content.category}</span>
              </MetaRow>
            )}

            {content.resource_type && (
              <MetaRow label="Type">
                <span className="text-foreground-muted capitalize">{content.resource_type}</span>
              </MetaRow>
            )}

            {content.tags.length > 0 && (
              <MetaRow label="Tags">
                <span className="flex flex-wrap gap-1">
                  {content.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-border px-1.5 py-0.5 font-body text-[10px] text-foreground-muted">
                      {tag}
                    </span>
                  ))}
                </span>
              </MetaRow>
            )}

            {content.url && (
              <MetaRow label="Link">
                <a
                  href={content.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 break-all text-accent hover:underline"
                >
                  {content.url} <ExternalLink size={11} strokeWidth={2.5} className="shrink-0" />
                </a>
              </MetaRow>
            )}

            {content.event && (
              <>
                <MetaRow label="Date">
                  <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                    <CalendarDays size={12} strokeWidth={2.5} />
                    {content.event.event_date ? formatDateTime(content.event.event_date) : "—"}
                    {content.event.end_date && ` → ${formatDateTime(content.event.end_date)}`}
                  </span>
                </MetaRow>
                <MetaRow label="Where">
                  <span className="text-foreground-muted">
                    {content.event.is_online ? "Online" : content.event.location ?? "—"}
                    {content.event.meet_link && (
                      <a
                        href={content.event.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        Meeting link <ExternalLink size={11} strokeWidth={2.5} />
                      </a>
                    )}
                  </span>
                </MetaRow>
                {content.event.max_attendees != null && (
                  <MetaRow label="Capacity">
                    <span className="inline-flex items-center gap-1.5 text-foreground-muted">
                      <Users size={12} strokeWidth={2.5} /> {content.event.max_attendees} attendees max
                    </span>
                  </MetaRow>
                )}
              </>
            )}
          </div>

          {content.description && (
            <div className="border-t border-border px-5 py-4">
              <p className="whitespace-pre-wrap font-body text-sm leading-6 text-foreground">
                {content.description}
              </p>
            </div>
          )}

          {content.poll && (
            <div className="border-t border-border px-5 py-4">
              <p className="font-body text-xs font-medium text-foreground">{content.poll.question}</p>
              <ul className="mt-2 space-y-1.5">
                {content.poll.options.map((option, optionIndex) => (
                  <li
                    key={`${optionIndex}-${option}`}
                    className="rounded-md border border-border px-3 py-1.5 font-body text-xs text-foreground-muted"
                  >
                    {option}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {content.links.length > 0 && (
            <div className="border-t border-border px-5 py-4">
              <p className="mb-1.5 font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                Links
              </p>
              <ul className="space-y-1">
                {content.links.map((link) => (
                  <li key={link}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 break-all font-body text-xs text-accent hover:underline"
                    >
                      {link} <ExternalLink size={11} strokeWidth={2.5} className="shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {content.attachments.length > 0 && (
            <div className="border-t border-border px-5 py-4">
              <p className="mb-2 font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                Media ({content.attachments.length})
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {content.attachments.map((attachment) =>
                  attachment.type.startsWith("image/") ? (
                    <a key={attachment.url} href={attachment.url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.url}
                        alt={attachment.name ?? "Reported media"}
                        className="h-32 w-full rounded-lg border border-border object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      key={attachment.url}
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-center transition-colors hover:bg-surface-raised"
                    >
                      {attachment.poster && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={attachment.poster} alt="" className="h-16 w-full rounded object-cover" />
                      )}
                      <span className="line-clamp-2 font-body text-[10px] text-foreground-muted">
                        {attachment.name ?? (attachment.type.startsWith("video/") ? "Video" : "File")}
                      </span>
                    </a>
                  ),
                )}
              </div>
            </div>
          )}

          {Object.keys(content.stats).length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3.5">
              {Object.entries(content.stats).map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-full bg-surface-raised px-2.5 py-1 font-body text-[11px] text-foreground-muted"
                >
                  <span className="font-semibold text-foreground">{value}</span>{" "}
                  {STAT_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Reports */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-sm font-semibold text-foreground">
              Reports ({counts.total})
            </h2>
            <p className="mt-0.5 font-body text-xs text-foreground-muted">
              {counts.reporters} member{counts.reporters === 1 ? "" : "s"} reported this
              {counts.pending > 0 && ` · ${counts.pending} pending`}
            </p>
          </div>

          {reports.length === 0 ? (
            <p className="px-4 py-8 text-center font-body text-xs text-foreground-muted">
              No reports on this post.
            </p>
          ) : (
            <ul>
              {reports.map((report) => (
                <li key={report.id} className="border-b border-border-subtle px-4 py-3.5 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {report.reporter && (
                        <AvatarImg
                          url={report.reporter.avatar_url}
                          name={report.reporter.name}
                          size={22}
                          className="h-[22px] w-[22px] shrink-0 rounded-full object-cover"
                        />
                      )}
                      {report.reporter ? (
                        <Link
                          href={`/admin/users/${report.reporter.id}`}
                          className="truncate font-body text-xs text-foreground-muted hover:text-accent hover:underline"
                        >
                          {report.reporter.name}
                        </Link>
                      ) : (
                        <span className="font-body text-xs text-foreground-subtle">Unknown member</span>
                      )}
                    </div>
                    <StatusBadge status={report.status} />
                  </div>

                  <p className="mt-2 font-body text-xs font-medium text-foreground">
                    {report.reason_label}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-foreground-subtle">
                    {formatDateTime(report.created_at)}
                    {report.resolved_at && ` · resolved ${formatDate(report.resolved_at)}`}
                  </p>

                  {report.details && (
                    <p className="mt-2 whitespace-pre-wrap rounded-md border-l-2 border-border bg-background-subtle px-2.5 py-2 font-body text-[11px] leading-5 text-foreground-muted">
                      {report.details}
                    </p>
                  )}

                  {report.status === "pending" && (
                    <button
                      onClick={() => void dismissReports([report.id])}
                      disabled={busy !== null}
                      className="mt-2 rounded-md px-2 py-1 font-body text-[11px] text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
                    >
                      Dismiss this report
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {removal && (
            <div className="border-t border-border px-4 py-3">
              <p className="font-body text-[11px] leading-5 text-foreground-muted">
                Removed {formatDateTime(removal.removed_at)}
                {removal.removed_by_name ? ` by ${removal.removed_by_name}` : ""}.
                {canRestore && " Restoring re-opens the reports marked removed."}
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Delete this post?"
        message={`This removes the ${REPORT_CONTENT_LABELS[content.type]} reported by ${counts.reporters} member${counts.reporters === 1 ? "" : "s"} and notifies the author plus every reporter. You can undo this right after.`}
        confirmLabel="Delete post"
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          await removePost();
          setConfirmRemove(false);
        }}
      />
    </div>
  );
}
