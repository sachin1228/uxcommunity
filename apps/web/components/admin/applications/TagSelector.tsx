"use client";

import { Tag } from "lucide-react";
import type { TagItem } from "./types";

interface Props {
  allTags: TagItem[];
  selectedTags: string[];
  onToggle: (id: string) => void;
}

export function TagSelector({ allTags, selectedTags, onToggle }: Props) {
  if (allTags.length === 0) return null;

  return (
    <div>
      <p className="font-body text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
        <Tag size={12} /> Internal Tags
      </p>
      <div className="flex flex-wrap gap-1.5">
        {allTags.map((tag) => {
          const active = selectedTags.includes(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => onToggle(tag.id)}
              className={`rounded-full px-2.5 py-0.5 font-body text-xs transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "border border-border bg-surface text-foreground-muted hover:border-accent/40 hover:text-foreground"
              }`}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
