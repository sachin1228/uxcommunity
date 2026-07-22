"use client";

import { Camera, Mail, Calendar } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";

function PaperClip() {
  return (
    <svg viewBox="0 0 32 72" className="w-6 h-14 text-foreground-muted/60 drop-shadow-sm" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M16 68 C5 68 2 60 2 52 L2 20 C2 10 8 4 16 4 C24 4 30 10 30 20 L30 52 C30 58 26 64 20 64 C14 64 10 59 10 53 L10 22 C10 17 13 14 16 14 C19 14 22 17 22 22 L22 52" />
    </svg>
  );
}

const fieldCls =
  "bg-transparent border-b border-border focus:border-accent outline-none text-foreground font-body text-sm transition-colors w-full pb-0.5 placeholder:text-foreground-subtle resize-none";

interface ProfileHeroProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  memberSince: string | null;
  bio: string;
  onNameChange: (v: string) => void;
  onBioChange: (v: string) => void;
  onOpenAvatarPicker: () => void;
}

export function ProfileHero({
  name,
  email,
  avatarUrl,
  memberSince,
  bio,
  onNameChange,
  onBioChange,
  onOpenAvatarPicker,
}: ProfileHeroProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-7 mb-5 relative overflow-hidden">
      {/* Decorative dots */}
      <div
        className="absolute top-0 right-0 w-48 h-48 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)", backgroundSize: "16px 16px" }}
      />

      <div className="flex gap-8 items-start relative">
        {/* Pinned photo */}
        <div className="shrink-0 flex flex-col items-center gap-3">
          <div className="relative" style={{ transform: "rotate(-3deg)" }}>
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-10">
              <PaperClip />
            </div>
            <div
              className="bg-white p-2 pb-3 shadow-xl rounded-sm mt-4"
              style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)" }}
            >
              <div className="w-28 h-28 overflow-hidden rounded-sm bg-overlay-elevated">
                {avatarUrl ? (
                  <AvatarImg url={avatarUrl} name={name} size={112} className="w-28 h-28 object-cover" />
                ) : (
                  <div className="w-28 h-28 flex items-center justify-center bg-accent/20">
                    <span className="font-display text-4xl font-bold text-accent">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onOpenAvatarPicker}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 font-body text-xs text-foreground-muted hover:text-accent hover:border-accent/40 transition-all mt-2"
          >
            <Camera size={11} />
            Change photo
          </button>
        </div>

        {/* Identity fields */}
        <div className="flex-1 grid grid-cols-1 gap-5 pt-1">
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Your name"
              className={fieldCls}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
              <Mail size={11} /> Email
            </label>
            <p className="font-body text-sm text-foreground-subtle pb-0.5 border-b border-border/40">{email}</p>
          </div>

          {memberSince && (
            <div className="flex flex-col gap-1.5">
              <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider flex items-center gap-1.5">
                <Calendar size={11} /> Member Since
              </label>
              <p className="font-body text-sm text-foreground-subtle pb-0.5 border-b border-border/40">{memberSince}</p>
            </div>
          )}
        </div>

        {/* Bio */}
        <div className="w-56 pt-1">
          <div className="flex flex-col gap-1.5">
            <label className="font-body text-[11px] font-medium text-foreground-muted uppercase tracking-wider">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => onBioChange(e.target.value)}
              placeholder="A short note about yourself — what you design, love, or believe in…"
              rows={3}
              className={fieldCls + " leading-relaxed"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
