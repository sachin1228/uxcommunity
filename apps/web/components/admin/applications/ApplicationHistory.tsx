"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import type { HistoryItem } from "./types";

interface Props {
  history: HistoryItem[];
}

export function ApplicationHistory({ history }: Props) {
  const [open, setOpen] = useState(false);

  if (history.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-body text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
        {history.length} previous application{history.length > 1 ? "s" : ""}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <div key={h.id} className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <ApplicationStatusBadge status={h.status} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(h.created_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex gap-2 mb-1.5">
                <a
                  href={h.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-body text-xs text-primary hover:text-primary"
                >
                  LinkedIn ↗
                </a>
                <span className="text-muted-foreground">·</span>
                <a
                  href={h.portfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-body text-xs text-primary hover:text-primary"
                >
                  Portfolio ↗
                </a>
              </div>
              {h.review_notes && (
                <p className="font-body text-xs text-muted-foreground">
                  {h.review_notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
