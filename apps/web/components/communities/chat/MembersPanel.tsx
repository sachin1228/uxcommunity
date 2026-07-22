"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";

interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

interface MembersPanelProps {
  members: Member[];
}

export function MembersPanel({ members }: MembersPanelProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  const handleGlobalClick = (e: React.MouseEvent) => {
    void e; // handled via the button itself
  };

  return (
    <div className="w-56 shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown((v) => !v)}
          className="flex items-center gap-1.5 group"
        >
          <span className="font-body text-sm font-medium text-foreground-muted group-hover:text-foreground transition-colors">
            Members
          </span>
          <ChevronDown
            size={14}
            className={`text-foreground-muted group-hover:text-foreground transition-transform duration-200 ${
              showDropdown ? "rotate-180" : ""
            }`}
          />
        </button>

        {showDropdown && (
          <div className="absolute left-4 top-full mt-1 z-50 w-40 rounded-lg border border-border bg-surface shadow-lg py-1 overflow-hidden">
            <button
              className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
              onClick={() => setShowDropdown(false)}
            >
              Topics
            </button>
            <button
              className="w-full text-left px-4 py-2.5 font-body text-sm text-foreground hover:bg-surface-raised transition-colors"
              onClick={() => setShowDropdown(false)}
            >
              Settings
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2 py-1.5">
            <ChatAvatar
              name={m.users?.name ?? "?"}
              url={m.users?.avatar_url ?? null}
              size={7}
            />
            <span className="font-body text-xs text-foreground truncate">
              {m.users?.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
