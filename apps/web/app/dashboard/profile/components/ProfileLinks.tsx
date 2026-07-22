"use client";

import { Linkedin, Globe } from "lucide-react";

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="font-mono text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">{num}</span>
      <span className="font-display text-xs font-semibold text-foreground-muted uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

const fieldCls =
  "bg-transparent border-b border-border focus:border-accent outline-none text-foreground font-body text-sm transition-colors w-full pb-0.5 placeholder:text-foreground-subtle";

interface ProfileLinksProps {
  linkedin: string;
  portfolio: string;
  onLinkedinChange: (v: string) => void;
  onPortfolioChange: (v: string) => void;
}

export function ProfileLinks({
  linkedin,
  portfolio,
  onLinkedinChange,
  onPortfolioChange,
}: ProfileLinksProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 mb-5">
      <SectionLabel num="02" label="Links" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
            <Linkedin size={11} /> LinkedIn
          </label>
          <input
            type="url"
            value={linkedin}
            onChange={(e) => onLinkedinChange(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className={fieldCls}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
            <Globe size={11} /> Portfolio
          </label>
          <input
            type="url"
            value={portfolio}
            onChange={(e) => onPortfolioChange(e.target.value)}
            placeholder="https://yourportfolio.com"
            className={fieldCls}
          />
        </div>
      </div>
    </div>
  );
}
