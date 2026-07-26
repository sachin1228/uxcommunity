"use client";

import { useRef, useState } from "react";
import { Pencil, ChevronDown, X, Check } from "lucide-react";
import { INTEREST_EMOJIS } from "@/lib/interests";
import { DropdownMenu } from "@/components/ui/DropdownMenu";

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="font-mono text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">{num}</span>
      <span className="font-display text-xs font-semibold text-foreground-muted uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

interface Interest {
  id: string;
  name: string;
  image_url?: string | null;
}

interface ProfileInterestsProps {
  allInterests: Interest[];
  interestIds: string[];
  onChange: (ids: string[]) => void;
}

export function ProfileInterests({
  allInterests,
  interestIds,
  onChange,
}: ProfileInterestsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedInterests = allInterests.filter((i) => interestIds.includes(i.id));

  function toggle(id: string) {
    onChange(
      interestIds.includes(id)
        ? interestIds.filter((x) => x !== id)
        : [...interestIds, id]
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 mb-8">
      <SectionLabel num="03" label="Design Interests" />

      {/* Selected chips */}
      <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
        {selectedInterests.length === 0 ? (
          <span className="font-body text-sm text-foreground-subtle ">No interests selected yet</span>
        ) : (
          selectedInterests.map((interest) => (
            <button
              key={interest.id}
              type="button"
              onClick={() => toggle(interest.id)}
              className="group flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-body text-xs text-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 transition-all"
            >
              <span>{INTEREST_EMOJIS[interest.name] ?? "🎨"}</span>
              {interest.name}
              <X size={10} className="opacity-50 group-hover:opacity-100" />
            </button>
          ))
        )}
      </div>

      {/* Dropdown trigger */}
      <div ref={containerRef} className="relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border hover:border-accent/40 bg-surface-raised px-4 py-2 font-body text-sm text-foreground-muted hover:text-foreground transition-all"
        >
          <Pencil size={12} />
          Edit interests
          <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Portal dropdown — always above other content */}
        <DropdownMenu
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          align="left"
          className="w-72"
        >
          <div className="max-h-72 overflow-y-auto">
            {allInterests.map((interest) => {
              const selected = interestIds.includes(interest.id);
              return (
                <button
                  key={interest.id}
                  type="button"
                  onClick={() => toggle(interest.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.08] transition-colors"
                >
                  <span className="text-base leading-none shrink-0">
                    {INTEREST_EMOJIS[interest.name] ?? "🎨"}
                  </span>
                  <span className="flex-1 font-body text-sm text-foreground">{interest.name}</span>
                  <span
                    className={`h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                      selected ? "bg-accent" : "border border-border"
                    }`}
                  >
                    {selected && <Check size={10} className="text-white" />}
                  </span>
                </button>
              );
            })}
          </div>
        </DropdownMenu>
      </div>
    </div>
  );
}
