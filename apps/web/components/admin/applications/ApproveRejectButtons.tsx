"use client";
import { Button } from "@/components/ui/shadcn/button";


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
      <Button variant="ghost"
        onClick={onApprove}
        disabled={!!actionLoading}
        className="flex flex-1 items-center justify-center gap-2 py-2 transition-colors disabled:opacity-60"
      >
        {actionLoading === "approve" ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <Check strokeWidth={2.5} size={13} />
        )}
        Approve &amp; Send Invite
      </Button>
      <Button variant="destructive"
        onClick={onReject}
        disabled={!!actionLoading}
        className="flex flex-1 items-center justify-center gap-2 py-2 transition-colors disabled:opacity-60"
      >
        {actionLoading === "reject" ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <X strokeWidth={2.5} size={13} />
        )}
        Reject
      </Button>
    </div>
  );
}
