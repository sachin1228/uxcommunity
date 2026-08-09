"use client";

import { useState, useEffect, useRef } from "react";
import { INTEREST_EMOJIS } from "@/lib/interests";

interface InterestOption {
  id: string;
  name: string;
  image_url?: string | null;
}

function InterestIcon({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const emoji = INTEREST_EMOJIS[name] ?? "🎨";
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-5 w-5 rounded object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return <span className="text-base leading-none">{emoji}</span>;
}

interface InterestsMultiSelectProps {
  options: InterestOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function InterestsMultiSelect({
  options,
  selected,
  onChange,
}: InterestsMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  function remove(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  const selectedOptions = options.filter((o) => selected.includes(o.id));

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`min-h-[42px] flex flex-wrap items-center gap-1.5 cursor-pointer rounded-md border px-3 py-2 transition-colors ${
          open
            ? "border-accent ring-2 ring-accent/20"
             : "border-border hover:border-foreground-subtle"
          } bg-surface`}
      >
        {selectedOptions.map((o) => (
          <span
            key={o.id}
            className="inline-flex items-center gap-1 rounded-md bg-surface-raised px-2 py-0.5 font-body text-xs text-foreground"
          >
            {o.name}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(o.id); }}
              className="text-foreground-muted hover:text-foreground transition-colors ml-0.5"
            >
              ×
            </button>
          </span>
        ))}
         <span className="flex-1 min-w-[80px] font-body text-sm text-foreground-muted select-none">
          {selectedOptions.length === 0 ? "Select topics…" : ""}
        </span>
        <svg
           className={`h-4 w-4 text-foreground-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-surface-raised shadow-md overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                   className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-background-subtle transition-colors"
                >
                  <InterestIcon imageUrl={option.image_url} name={option.name} />
                   <span className="flex-1 font-body text-sm text-foreground">
                    {option.name}
                  </span>
                  <span
                    className={`h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                       isSelected ? "bg-accent" : "border border-foreground-subtle"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
