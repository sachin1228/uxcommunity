"use client";

import { AtSign, Loader2 } from "lucide-react";
import { ChatAvatar } from "./ChatAvatar";
import type { MentionCandidate } from "@/lib/communities/mentions";

interface MentionSuggestionsProps {
  query: string;
  loading: boolean;
  options: MentionCandidate[];
  activeIndex: number;
  onPick: (option: MentionCandidate) => void;
  onHover: (index: number) => void;
}

/** Accent the part of the name that matches the typed query. */
function NameWithMatch({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;
  const index = name.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, index)}
      <span className="text-accent">{name.slice(index, index + query.length)}</span>
      {name.slice(index + query.length)}
    </>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "owner") {
    return (
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-bold uppercase tracking-wider leading-none">
        Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[9px] font-bold uppercase tracking-wider leading-none">
        Admin
      </span>
    );
  }
  return null;
}

/**
 * Member @mention popover, shown above the composer while an `@query` token is
 * being typed. Rendered inside ChatInput so it can anchor to the input box.
 * Keyboard navigation is handled by the parent (arrows/Enter/Escape are
 * intercepted before the send handler); this panel only reports hover + pick.
 */
export function MentionSuggestions({
  query,
  loading,
  options,
  activeIndex,
  onPick,
  onHover,
}: MentionSuggestionsProps) {
  const isEmpty = !loading && options.length === 0;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div
        role="listbox"
        aria-label="Mention a member"
        aria-busy={loading}
        className="max-h-64 overflow-y-auto py-1"
        onMouseDown={(e) => e.preventDefault() /* keep textarea focused */}
      >
        {loading && options.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Loader2 strokeWidth={2.5} size={13} className="animate-spin text-foreground-muted shrink-0" />
            <p className="font-body text-xs text-foreground-muted">Searching members…</p>
          </div>
        ) : isEmpty ? (
          <div className="flex items-center gap-2 px-3 py-2.5">
            <AtSign strokeWidth={2.5} size={13} className="text-foreground-muted shrink-0" />
            <p className="font-body text-xs text-foreground-muted">
              No members match “{query}”
            </p>
          </div>
        ) : (
          options.map((option, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={option.user_id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseMove={() => onHover(index)}
                onClick={() => onPick(option)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  active ? "bg-accent/15" : "hover:bg-white/[0.06]"
                }`}
              >
                <ChatAvatar name={option.name} url={option.avatar_url} size={7} />
                <span className="min-w-0 flex-1 flex items-center gap-2">
                  <span className="font-body text-[13px] font-medium text-foreground truncate">
                    <NameWithMatch name={option.name} query={query} />
                  </span>
                  {option.role ? <RoleBadge role={option.role} /> : null}
                </span>
                {option.designation && (
                  <span className="shrink-0 font-body text-[11px] text-foreground-muted truncate max-w-[7rem]">
                    {option.designation}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Hint footer */}
      <div className="flex items-center justify-between border-t border-border bg-background-subtle px-3 py-1.5">
        <p className="font-body text-[10px] text-foreground-muted/80">
          {isEmpty ? "Enter to close" : "Mention a member"}
        </p>
        <p className="font-body text-[10px] text-foreground-muted/60">
          ↑↓ navigate · ↵ select · esc close
        </p>
      </div>
    </div>
  );
}
