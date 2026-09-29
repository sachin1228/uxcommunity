"use client";

import { BadgeCheck } from "lucide-react";

/**
 * Company logo, falling back to the company's initial. A company legitimately
 * has no logo (a newly created one is allowed to start empty), and a
 * user-uploaded logo is never proof of ownership — it is decoration next to
 * the verified domain, which is the actual signal.
 */
export function CompanyLogo({
  name,
  logoUrl,
  size = 32,
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        style={style}
        className={`shrink-0 rounded-md border border-border bg-surface object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-body text-xs font-semibold uppercase text-foreground-muted select-none ${className}`}
    >
      {name.trim()[0] ?? "?"}
    </span>
  );
}

/**
 * The verified indicator. It says one thing only: the domain next to it was
 * proven by a work email. It deliberately does not read as "official
 * representative", which is why the label stays "Verified" and never "Official".
 */
export function VerifiedMark({
  label = true,
  title = "Domain verified by a work email",
  size = "sm",
}: {
  label?: boolean;
  title?: string;
  size?: "xs" | "sm";
}) {
  const iconSize = size === "xs" ? 10 : 12;
  return (
    <span
      title={title}
      className={
        size === "xs"
          ? "inline-flex items-center gap-1 font-body text-[10px] font-medium text-accent"
          : "inline-flex items-center gap-1 font-body text-xs font-medium text-accent"
      }
    >
      <BadgeCheck strokeWidth={2.5} size={iconSize} />
      {label ? "Verified" : null}
    </span>
  );
}
