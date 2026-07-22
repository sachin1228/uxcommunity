"use client";

import { Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  actionLoading: "approve" | "reject" | null;
  onApprove: () => void;
  onReject: () => void;
}

export function ApproveRejectButtons({ actionLoading, onApprove, onReject }: Props) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onApprove}
        disabled={!!actionLoading}
        className="flex flex-1 items-center justify-center gap-2 rounded-md bg-green-600 py-2 font-body text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
      >
        {actionLoading === "approve" ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <Check size={13} />
        )}
        Approve &amp; Send Invite
      </button>
      <button
        onClick={onReject}
        disabled={!!actionLoading}
        className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 py-2 font-body text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-60"
      >
        {actionLoading === "reject" ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <X size={13} />
        )}
        Reject
      </button>
    </div>
  );
}
