"use client";

import { useState } from "react";
import { ChevronRight, Users, MessageSquare } from "lucide-react";
import { TYPE_EMOJI, TYPE_LABELS, TYPE_COLORS } from "./communityTypes";

export interface CommunityListItem {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  is_active: boolean;
  member_count: number;
  message_count: number;
  created_at: string;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

interface Props {
  community: CommunityListItem;
  isLast: boolean;
  onClick: () => void;
}

export function CommunityRow({ community: c, isLast, onClick }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const fallback = TYPE_EMOJI[c.type] ?? "💬";

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors hover:bg-surface-raised ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      {/* Name + avatar */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {c.image_url && !imgFailed ? (
            <img
              src={c.image_url}
              alt={c.name}
              className="h-8 w-8 rounded-full object-cover shrink-0"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-surface-raised flex items-center justify-center shrink-0 text-sm select-none">
              {fallback}
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="font-body text-sm text-foreground">{c.name}</span>
            {!c.is_active && (
              <span className="px-1.5 py-0.5 rounded-full font-body text-[10px] font-medium bg-amber-500/10 text-amber-500">
                Deactivated
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Type badge */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body text-[11px] font-medium ${
            TYPE_COLORS[c.type] ?? "bg-surface-raised text-foreground-muted"
          }`}
        >
          {TYPE_LABELS[c.type] ?? c.type}
        </span>
      </td>

      {/* Members */}
      <td className="px-4 py-3 text-right">
        <span className="flex items-center justify-end gap-1 font-mono text-xs text-foreground-muted">
          <Users size={11} />
          {c.member_count.toLocaleString()}
        </span>
      </td>

      {/* Messages */}
      <td className="px-4 py-3 text-right">
        <span className="flex items-center justify-end gap-1 font-mono text-xs text-foreground-muted">
          <MessageSquare size={11} />
          {c.message_count.toLocaleString()}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3 text-right">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full font-body text-[11px] font-medium ${
            c.is_active
              ? "bg-green-500/10 text-green-400"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {c.is_active ? "Active" : "Deactivated"}
        </span>
      </td>

      {/* Created */}
      <td className="px-4 py-3 text-right font-body text-xs text-foreground-muted">
        {fmtDate(c.created_at)}
      </td>

      {/* Chevron */}
      <td className="px-4 py-3 text-right">
        <ChevronRight size={14} className="text-foreground-muted ml-auto" />
      </td>
    </tr>
  );
}
