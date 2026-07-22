"use client";

import { useState, useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import { InviteLinkBox } from "./InviteLinkBox";
import { ApproveRejectButtons } from "./ApproveRejectButtons";
import { TagSelector } from "./TagSelector";
import { ReviewNotesEditor } from "./ReviewNotesEditor";
import { ApplicationHistory } from "./ApplicationHistory";
import type { Application, AppTag, HistoryItem, TagItem } from "./types";

interface Props {
  app: Application;
  onClose: () => void;
  onRefresh: () => void;
}

export function ApplicationDetailModal({ app, onClose, onRefresh }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>(
    app.application_tags.map((t) => t.tag_id)
  );
  const [notes, setNotes] = useState(app.review_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<"approve" | "reject" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inviteLink = inviteToken ? `${appUrl}/signup?token=${inviteToken}` : null;

  useEffect(() => {
    fetch(`/api/admin/applications/${app.id}`)
      .then((r) => r.json())
      .then((d) => {
        setHistory(d.history ?? []);
        setNotes(d.application?.review_notes ?? "");
        setSelectedTags(
          (d.application?.application_tags ?? []).map((t: AppTag) => t.tag_id)
        );
        if (d.inviteToken) setInviteToken(d.inviteToken);
      })
      .catch(() => {});

    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then((d) => setAllTags(d.tags ?? []))
      .catch(() => {});
  }, [app.id]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/admin/applications/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_notes: notes, tag_ids: selectedTags }),
    });
    setSaving(false);
    onRefresh();
  }

  async function handleAction(action: "approve" | "reject") {
    setActionLoading(action);
    setActionMsg(null);
    setActionWarning(false);
    const res = await fetch(`/api/admin/applications/${app.id}/${action}`, { method: "POST" });
    const data = await res.json();
    setActionLoading(null);
    if (res.ok) {
      if (data.token) setInviteToken(data.token);
      setActionMsg(data.warning ?? `Application ${action}d successfully.`);
      setActionWarning(!!data.warning);
      onRefresh();
    } else {
      setActionMsg(data.error ?? "Action failed.");
    }
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" hideCloseButton>
      <div className="flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <h2 className="font-display text-lg font-semibold text-foreground">{app.name}</h2>
              <ApplicationStatusBadge status={app.status} />
            </div>
            <p className="font-body text-xs text-foreground-muted">{app.email}</p>
            <p className="font-mono text-[10px] text-foreground-muted mt-0.5">
              Applied{" "}
              {new Date(app.created_at).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors mt-0.5"
          >
            <X size={16} />
          </button>
        </div>

        {/* External links */}
        <div className="flex gap-2">
          <a
            href={app.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >
            <ExternalLink size={12} /> LinkedIn
          </a>
          <a
            href={app.portfolio_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
          >
            <ExternalLink size={12} /> Portfolio
          </a>
        </div>

        {/* Action feedback */}
        {actionMsg && (
          <div
            className={`rounded-md border px-3 py-2.5 ${
              actionWarning
                ? "border-yellow-500/30 bg-yellow-500/5"
                : "border-border bg-surface"
            }`}
          >
            <p className="font-body text-xs text-foreground-muted">{actionMsg}</p>
          </div>
        )}

        {/* Invite link */}
        {inviteLink && <InviteLinkBox inviteLink={inviteLink} />}

        {/* Approve / Reject */}
        {app.status === "pending" && (
          <ApproveRejectButtons
            actionLoading={actionLoading}
            onApprove={() => handleAction("approve")}
            onReject={() => handleAction("reject")}
          />
        )}

        {/* Tags */}
        <TagSelector
          allTags={allTags}
          selectedTags={selectedTags}
          onToggle={(id) =>
            setSelectedTags((prev) =>
              prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
            )
          }
        />

        {/* Notes + Save */}
        <ReviewNotesEditor
          notes={notes}
          saving={saving}
          onChange={setNotes}
          onSave={handleSave}
        />

        {/* History */}
        <ApplicationHistory history={history} />

      </div>
    </Modal>
  );
}
