"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { CommunityMessage } from "./communityTypes";
import { fmtDateTime } from "./communityTypes";

interface Props {
  communityId: string;
  messages: CommunityMessage[];
  messageCount: number;
  onMessageDeleted: (msgId: string) => void;
}

export function CommunityMessagesList({
  communityId,
  messages,
  messageCount,
  onMessageDeleted,
}: Props) {
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  const [confirmMsgId, setConfirmMsgId] = useState<string | null>(null);

  async function handleDeleteMessage(msgId: string) {
    setDeletingMsgId(msgId);
    try {
      await fetch(`/api/admin/communities/${communityId}/messages/${msgId}`, {
        method: "DELETE",
      });
      onMessageDeleted(msgId);
    } finally {
      setDeletingMsgId(null);
      setConfirmMsgId(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h2 className="font-body text-xs font-semibold text-foreground">
          Recent Messages
          <span className="ml-2 font-mono text-[11px] text-foreground-muted font-normal">
            {messageCount > 10
              ? `Last 10 of ${messageCount.toLocaleString()}`
              : messageCount}
          </span>
        </h2>
      </div>

      {messages.length === 0 ? (
        <p className="px-5 py-6 font-body text-xs text-foreground-muted">No messages yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="px-5 py-3 group hover:bg-surface-raised transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-body text-[11px] font-medium text-foreground">
                      {msg.user_name}
                    </span>
                    <span className="font-body text-[11px] text-foreground-muted">
                      {fmtDateTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="font-body text-xs text-foreground-muted line-clamp-2">
                    {msg.content}
                  </p>
                </div>

                {confirmMsgId === msg.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-body text-[11px] text-foreground-muted">Delete?</span>
                    <button
                      onClick={() => handleDeleteMessage(msg.id)}
                      disabled={deletingMsgId === msg.id}
                      className="font-body text-[11px] text-red-400 hover:text-red-300 font-medium disabled:opacity-50"
                    >
                      {deletingMsgId === msg.id ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        "Yes"
                      )}
                    </button>
                    <button
                      onClick={() => setConfirmMsgId(null)}
                      className="font-body text-[11px] text-foreground-muted hover:text-foreground"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmMsgId(msg.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 text-foreground-muted hover:text-red-400 rounded"
                    title="Delete message"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
