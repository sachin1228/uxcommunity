"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Label } from "@/components/ui/shadcn/label";
import { Input } from "@/components/ui/shadcn/input";


import {
  Camera, Mail, Calendar,
  MapPin, Layers, Star, Lock,
  Linkedin, Globe,
} from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

const fieldCls =
  "bg-transparent border-b border-border focus:border-primary outline-none text-foreground font-body text-xs transition-colors w-full pb-0.5 placeholder:text-muted-foreground";

interface ProfileCardProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  memberSince: string | null;
  onOpenAvatarPicker: () => void;
  city: string | null;
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
  city, sector, experienceLevel,
  linkedin, portfolio, onLinkedinChange, onPortfolioChange,
}: ProfileCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card mb-6 overflow-hidden">

      {/* ── Top row: avatar · identity info · links ── */}
      <div className="flex items-stretch divide-x divide-border">

        {/* Avatar */}
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-4 shrink-0">
          <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-border bg-primary/20">
            {avatarUrl ? (
              <AvatarImg url={avatarUrl} name={name} size={56} className="w-14 h-14 object-cover" />
            ) : (
              <div className="w-14 h-14 flex items-center justify-center">
                <span className="font-display text-xl font-bold text-primary">
                  {name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <Button variant="outline"
            onClick={onOpenAvatarPicker}
            className="flex items-center gap-1 px-2.5 py-1 transition-all whitespace-nowrap"
          >
            <Camera strokeWidth={2.5} size={9} />
            Change photo
          </Button>
        </div>

        {/* Name / email / since — all read-only */}
        <div className="flex flex-col justify-center gap-2.5 px-5 py-4 flex-1 min-w-0">
          <div>
            <p className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Name
            </p>
            <p className="font-body text-sm font-medium text-foreground truncate">{name}</p>
          </div>
          <div className="flex gap-5">
            <div className="min-w-0">
              <p className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-0.5">
                <Mail strokeWidth={2.5} size={9} /> Email
              </p>
              <p className="font-body text-xs text-muted-foreground truncate">{email}</p>
            </div>
            {memberSince && (
              <div className="shrink-0">
                <p className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-0.5">
                  <Calendar strokeWidth={2.5} size={9} /> Since
                </p>
                <p className="font-body text-xs text-muted-foreground">{memberSince}</p>
              </div>
            )}
          </div>
        </div>

        {/* LinkedIn + Portfolio */}
        <div className="flex flex-col justify-center gap-3 px-5 py-4 w-64 shrink-0">
          <div>
            <Label className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1">
              <Linkedin strokeWidth={2.5} size={9} /> LinkedIn
            </Label>
            <Input
              type="url"
              value={linkedin}
              onChange={(e) => onLinkedinChange(e.target.value)}
              placeholder="https://linkedin.com/in/yourname"
              className={fieldCls}
            />
          </div>
          <div>
            <Label className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-1">
              <Globe strokeWidth={2.5} size={9} /> Portfolio
            </Label>
            <Input
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
        <span className="font-body text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0 mr-1">
          Identity
        </span>
        {city && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-popover px-2.5 py-1 font-body text-xs text-foreground">
            <MapPin strokeWidth={2.5} size={10} className="text-primary shrink-0" />{city}
          </span>
        )}
        {sector && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-popover px-2.5 py-1 font-body text-xs text-foreground">
            <Layers strokeWidth={2.5} size={10} className="text-primary shrink-0" />{sector}
          </span>
        )}
        {experienceLevel && (
          <span className="flex items-center gap-1 rounded-lg border border-border bg-popover px-2.5 py-1 font-body text-xs text-foreground capitalize">
            <Star strokeWidth={2.5} size={10} className="text-primary shrink-0" />{experienceLevel.replace(/_/g, " ")}
          </span>
        )}
        <span className="flex items-center gap-1 font-body text-[10px] text-muted-foreground ml-auto shrink-0">
          <Lock strokeWidth={2.5} size={9} /> Not editable here
        </span>
      </div>
    </div>
  );
}
