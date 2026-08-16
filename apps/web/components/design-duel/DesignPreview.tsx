"use client";

import { useEffect, useRef, useState } from "react";
import type { DuelDesign } from "@/lib/design-duel/types";
import { componentStyle } from "@/lib/design-duel/design";

interface DesignPreviewProps {
  design: DuelDesign | null;
  /** Pre-rendered preview image (R2 URL) — takes precedence over `design`. */
  imageUrl?: string | null;
  /** Natural frame width used to derive the display scale. */
  width?: number;
  className?: string;
  ariaLabel?: string;
}

export function DesignPreview({
  design,
  imageUrl,
  width = 375,
  className = "",
  ariaLabel,
}: DesignPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  const frameW = design?.frame.width ?? width;
  const frameH = design?.frame.height ?? 812;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      setScale(avail > 0 ? Math.min(1, avail / frameW) : 0);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frameW]);

  if (!design && !imageUrl) return null;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden bg-white ${className}`}
      style={{ height: scale > 0 ? Math.max(120, Math.round(frameH * scale)) : undefined }}
      aria-label={ariaLabel}
      role="img"
    >
      <div
        style={{
          width: frameW,
          height: frameH,
          transform: scale > 0 ? `scale(${scale})` : undefined,
          transformOrigin: "top left",
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{ background: "#fff" }}
          />
        ) : (
          <div
            className="relative"
            style={{ width: frameW, height: frameH, background: "#fff", overflow: "hidden" }}
          >
            {design?.components.map((component) => (
              <div key={component.id} style={componentStyle(component)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}