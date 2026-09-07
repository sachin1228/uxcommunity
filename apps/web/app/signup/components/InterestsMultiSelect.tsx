"use client";
import { Button } from "@/components/ui/shadcn/button";


import { useState, useEffect, useRef } from "react";
import { INTEREST_EMOJIS, MAX_DESIGN_INTERESTS } from "@/lib/interests";

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
      /* eslint-disable-next-line @next/next/no-img-element */
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

  const atLimit = selected.length >= MAX_DESIGN_INTERESTS;

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
      return;
    }
    if (atLimit) return; // the dropdown shows why
    onChange([...selected, id]);
  }
  function remove(id: string) {
    onChange(selected.filter((s) => s !== id));
  }

  const selectedOptions = options.filter((o) => selected.includes(o.id));

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[42px] cursor-pointer flex-wrap items-center gap-1.5 rounded-md border bg-card px-3 py-2 transition-colors ${
          open
            ? "border-primary ring-2 ring-primary/20"
            : "border-border hover:border-muted-foreground"
        }`}
      >
        {selectedOptions.map((o) => (
          <span
            key={o.id}
            className="inline-flex items-center gap-1 rounded-md bg-popover px-2 py-0.5 font-body text-xs text-foreground"
          >
            {o.name}
            <Button variant="ghost"
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(o.id); }}
              className="ml-0.5 transition-colors"
              aria-label={`Remove ${o.name}`}
            >
              ×
            </Button>
          </span>
        ))}
        <span className="flex-1 min-w-[80px] select-none font-body text-sm text-muted-foreground">
          {selectedOptions.length === 0 ? "Select topics…" : ""}
        </span>
        {selected.length > 0 && (
          <span className="shrink-0 rounded-full border border-border bg-popover px-2 py-0.5 font-body text-[10px] font-semibold text-muted-foreground tabular-nums">
            {selected.length}/{MAX_DESIGN_INTERESTS}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {atLimit && (
            <div className="border-b border-border bg-primary/5 px-4 py-2">
              <p className="font-body text-xs text-muted-foreground">
                Maximum of {MAX_DESIGN_INTERESTS} topics selected — remove one to pick another.
              </p>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <Button variant="ghost"
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                  aria-pressed={isSelected}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                >
                  <InterestIcon imageUrl={option.image_url} name={option.name} />
                  <span className="flex-1 font-body text-sm text-foreground">
                    {option.name}
                  </span>
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground bg-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && (
                      <svg
                        className="h-3 w-3 text-primary-foreground"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
