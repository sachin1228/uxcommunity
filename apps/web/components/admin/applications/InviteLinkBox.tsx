"use client";

import { useState } from "react";
import { Link, Copy, CheckCheck } from "lucide-react";

interface Props {
  inviteLink: string;
}

export function InviteLinkBox({ inviteLink }: Props) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
        <Link size={12} /> Invitation Link
      </p>
      <div className="flex items-center gap-2">
        <p className="font-mono text-xs text-foreground-muted bg-surface-raised rounded px-2.5 py-1.5 flex-1 truncate select-all">
          {inviteLink}
        </p>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors shrink-0"
        >
          {copied ? (
            <CheckCheck size={12} className="text-green-400" />
          ) : (
            <Copy size={12} />
          )}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="font-body text-[10px] text-foreground-muted mt-1.5">
        Share this link with the applicant to let them create their account.
      </p>
    </div>
  );
}
