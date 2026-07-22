"use client";

import { MapPin, Building2, Layers, Star, Lock } from "lucide-react";

function SectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="font-mono text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">{num}</span>
      <span className="font-display text-xs font-semibold text-foreground-muted uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

interface ProfileIdentityProps {
  city: string | null;
  company: string | null;
  sector: string | null;
  experienceLevel: string | null;
}

export function ProfileIdentity({
  city,
  company,
  sector,
  experienceLevel,
}: ProfileIdentityProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 mb-5">
      <SectionLabel num="01" label="Professional Identity" />
      <div className="flex flex-wrap gap-3 mb-3">
        {city && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
            <MapPin size={13} className="text-accent shrink-0" />
            <span className="font-body text-sm text-foreground">{city}</span>
          </div>
        )}
        {company && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
            <Building2 size={13} className="text-accent shrink-0" />
            <span className="font-body text-sm text-foreground">{company}</span>
          </div>
        )}
        {sector && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
            <Layers size={13} className="text-accent shrink-0" />
            <span className="font-body text-sm text-foreground">{sector}</span>
          </div>
        )}
        {experienceLevel && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3.5 py-2">
            <Star size={13} className="text-accent shrink-0" />
            <span className="font-body text-sm text-foreground capitalize">
              {experienceLevel.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 font-body text-[11px] text-foreground-subtle">
        <Lock size={10} />
        These are linked to your community membership and can&apos;t be changed here.
      </p>
    </div>
  );
}
