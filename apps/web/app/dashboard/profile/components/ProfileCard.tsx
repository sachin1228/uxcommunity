"use client";

import {
  Camera, Mail, Calendar,
  MapPin, Building2, Layers, Star, Lock,
  Linkedin, Globe,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

const fieldCls =
  "bg-transparent border-b border-border focus:border-accent outline-none text-foreground font-body text-xs transition-colors w-full pb-0.5 placeholder:text-foreground-subtle";

interface ProfileCardProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  memberSince: string | null;
  onOpenAvatarPicker: () => void;
  city: string | null;
  company: string | null;
  sector: string | null;
  experienceLevel: string | null;
  linkedin: string;
  portfolio: string;
  onLinkedinChange: (v: string) => void;
  onPortfolioChange: (v: string) => void;
}

export function ProfileCard({
  name, email, avatarUrl, memberSince,
  onOpenAvatarPicker,
  city, company, sector, experienceLevel,
  linkedin, portfolio, onLinkedinChange, onPortfolioChange,
}: ProfileCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface mb-6 overflow-hidden">

      {/* ── Top row: avatar · identity info · links ── */}
      <div className="flex items-stretch divide-x divide-border">

        {/* Avatar */}
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-4 shrink-0">
          <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-border bg-accent/20">
            {avatarUrl ? (
              <AvatarImg url={avatarUrl} name={name} size={56} className="w-14 h-14 object-cover" />
            ) : (
              <div className="w-14 h-14 flex items-center justify-center">
                <span className="font-display text-xl font-bold text-accent">
                  {name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onOpenAvatarPicker}
            className="flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2.5 py-1 font-body text-[10px] text-foreground-muted hover:text-accent hover:border-accent/40 transition-all whitespace-nowrap"
          >
            <Camera size={9} />
            Change photo
          </button>
        </div>

        {/* Name / email / since — all read-only */}
        <div className="flex flex-col justify-center gap-2.5 px-5 py-4 flex-1 min-w-0">
          <div>
            <p className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider mb-0.5">
              Name
            </p>
            <p className="font-body text-sm font-medium text-foreground truncate">{name}</p>
          </div>
          <div className="flex gap-5">
            <div className="min-w-0">
              <p className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1 mb-0.5">
                <Mail size={9} /> Email
              </p>
              <p className="font-body text-xs text-foreground-subtle truncate">{email}</p>
            </div>
            {memberSince && (
              <div className="shrink-0">
                <p className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <Calendar size={9} /> Since
                </p>
                <p className="font-body text-xs text-foreground-subtle">{memberSince}</p>
              </div>
            )}
          </div>
        </div>

        {/* LinkedIn + Portfolio */}
        <div className="flex flex-col justify-center gap-3 px-5 py-4 w-64 shrink-0">
          <div>
            <label className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1 mb-1">
              <Linkedin size={9} /> LinkedIn
            </label>
            <input
              type="url"
              value={linkedin}
              onChange={(e) => onLinkedinChange(e.target.value)}
              placeholder="https://linkedin.com/in/yourname"
              className={fieldCls}
            />
          </div>
          <div>
            <label className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider flex items-center gap-1 mb-1">
              <Globe size={9} /> Portfolio
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

      {/* ── Bottom row: professional identity chips ── */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-border flex-wrap">
        <span className="font-body text-[10px] font-semibold text-foreground-muted uppercase tracking-wider shrink-0 mr-1">
          Identity
        </span>
        {city && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground">
            <MapPin size={10} className="text-accent shrink-0" />{city}
          </span>
        )}
        {company && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground">
            <Building2 size={10} className="text-accent shrink-0" />{company}
          </span>
        )}
        {sector && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground">
            <Layers size={10} className="text-accent shrink-0" />{sector}
          </span>
        )}
        {experienceLevel && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised px-2.5 py-1 font-body text-xs text-foreground capitalize">
            <Star size={10} className="text-accent shrink-0" />{experienceLevel.replace(/_/g, " ")}
          </span>
        )}
        <span className="flex items-center gap-1 font-body text-[10px] text-foreground-subtle ml-auto shrink-0">
          <Lock size={9} /> Not editable here
        </span>
      </div>
    </div>
  );
}
