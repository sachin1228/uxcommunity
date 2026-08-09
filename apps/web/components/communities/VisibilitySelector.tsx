"use client";

import { Check, Globe, Users } from "lucide-react";

interface VisibilitySelectorProps {
  isPublic: boolean;
  onChange: (isPublic: boolean) => void;
}

const options = [
  {
    value: true,
    label: "Anyone",
    description: "Anyone on UX Community can see this post.",
    Icon: Globe,
  },
  {
    value: false,
    label: "This community only",
    description: "Only members of this community can see this post.",
    Icon: Users,
  },
] as const;

export function VisibilitySelector({ isPublic, onChange }: VisibilitySelectorProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3.5">
      <h3 className="font-body text-sm font-semibold text-foreground">
        Who can see your post?
      </h3>
      <div className="mt-2 space-y-1.5" role="radiogroup" aria-label="Post visibility">
        {options.map(({ value, label, description, Icon }) => {
          const selected = isPublic === value;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(value)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-accent bg-accent/10"
                  : "border-transparent hover:border-border hover:bg-surface"
              }`}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  selected ? "bg-accent/15 text-accent" : "bg-surface text-foreground-muted"
                }`}
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-body text-sm font-semibold text-foreground">{label}</span>
                <span className="mt-0.5 block font-body text-[11px] text-foreground-muted">{description}</span>
              </span>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  selected ? "border-accent bg-accent" : "border-foreground-subtle"
                }`}
                aria-hidden="true"
              >
                {selected && <Check size={13} className="text-accent-foreground" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}