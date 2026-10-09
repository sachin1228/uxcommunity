"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";

/**
 * Company logo, falling back to the company's initial. A company legitimately
 * has no logo (a newly created one is allowed to start empty), and a
 * user-uploaded logo is never proof of ownership — it is decoration next to
 * the verified domain, which is the actual signal.
 *
 * The image is allowed to fail quietly. Most logos are resolved from the
 * company's domain (see lib/companies/logos.ts) and the provider answers 404
 * for a domain it has no icon for, so an error is an ordinary outcome, not a
 * broken page: the initial takes over instead.
 */
export function CompanyLogo({
  name,
  logoUrl,
  size = 32,
  shape = "square",
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  /** Compose the mark as a small closed circle (chips, cards) or a tile. */
  shape?: "square" | "circle";
  className?: string;
}) {
  // Remembered per URL rather than as a boolean, so a logo that changes (a
  // company gets a real one) is retried without an effect resetting state.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size };
  const radius = shape === "circle" ? "rounded-full" : "rounded-md";

  if (logoUrl && logoUrl !== failedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        style={style}
        onError={() => setFailedUrl(logoUrl)}
        className={`shrink-0 ${radius} border border-border bg-surface object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={style}
      className={`flex shrink-0 items-center justify-center ${radius} border border-border bg-surface-raised font-body text-xs font-semibold uppercase text-foreground-muted select-none ${className}`}
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
