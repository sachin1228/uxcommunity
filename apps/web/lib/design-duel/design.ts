// Design Duel — design JSON helpers shared by the editor, the
// read-only preview renderer, and the canvas image generator.
// Client-safe (no server-only imports).

import type { CSSProperties } from "react";
import type { DuelComponent, DuelComponentType, DuelDesign } from "./types";

const COLORS = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

function color(value: unknown, fallback: string | null): string | null {
  if (typeof value === "string" && COLORS.test(value.trim())) return value.trim();
  return fallback;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

export function sanitizeDesign(raw: unknown): DuelDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const design = raw as { frame?: unknown; components?: unknown };
  const frameRaw = (design.frame ?? {}) as { width?: unknown; height?: unknown };
  const width = clamp(Number(frameRaw.width) || 375, 200, 600);
  const height = clamp(Number(frameRaw.height) || 812, 300, 1600);
  const rawComponents = Array.isArray(design.components) ? design.components : [];
  const components: DuelComponent[] = [];
  let counter = 0;
  for (const item of rawComponents) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const type = ["text", "button", "card", "image", "input"].includes(String(c.type))
      ? (c.type as DuelComponentType)
      : "card";
    if (type === "image" && !c.imageUrl && !color(c.background, null)) continue;
    counter += 1;
    components.push({
      id: typeof c.id === "string" ? c.id.slice(0, 80) : `c${counter}`,
      type,
      x: clamp(Number(c.x) || 0, 0, width),
      y: clamp(Number(c.y) || 0, 0, height),
      width: clamp(Number(c.width) || 120, 8, width * 2),
      height: clamp(Number(c.height) || 40, 8, height * 2),
      text: textValue(c.text),
      fontSize: clamp(Number(c.fontSize) || 14, 8, 96),
      fontWeight: clamp(Number(c.fontWeight) || 400, 100, 900),
      color: color(c.color, "#111111") ?? "#111111",
      background: color(c.background, type === "button" ? "#0070F3" : type === "input" ? "#F5F5F5" : null),
      radius: clamp(Number(c.radius) || 0, 0, 48),
      padding: clamp(Number(c.padding) || (type === "card" || type === "input" ? 16 : 0), 0, 64),
      align: ["left", "center", "right"].includes(String(c.align)) ? (c.align as DuelComponent["align"]) : "left",
      opacity: clamp(Number(c.opacity) ?? 1, 0.1, 1),
      imageUrl: typeof c.imageUrl === "string" ? c.imageUrl.slice(0, 2048) : null,
    });
  }
  if (components.length === 0) return null;
  return { frame: { width, height }, components };
}

export function makeComponent(id: string, type: DuelComponentType, x: number, y: number): DuelComponent {
  const base = {
    id,
    type,
    x,
    y,
    width: type === "button" ? 200 : type === "text" ? 200 : type === "image" ? 220 : type === "input" ? 300 : 300,
    height: type === "button" ? 48 : type === "text" ? 24 : type === "image" ? 140 : type === "input" ? 52 : 96,
    text: type === "button" ? "Button" : type === "text" ? "Double-click to edit" : type === "input" ? "Placeholder text" : "",
    fontSize: type === "button" ? 15 : type === "text" ? 16 : 14,
    fontWeight: type === "text" ? 600 : 500,
    color: type === "button" ? "#ffffff" : "#111111",
    background: type === "button" ? "#0070F3" : type === "input" ? "#F5F5F5" : type === "card" ? "#FFFFFF" : "#EAF2FE",
    radius: type === "button" || type === "input" || type === "image" ? 12 : 16,
    padding: type === "input" ? 16 : 0,
    align: "left",
    opacity: 1,
  };
  if (type === "image") {
    (base as DuelComponent).imageUrl = null;
  }
  return base as DuelComponent;
}

export function componentStyle(component: DuelComponent): CSSProperties {
  const style: CSSProperties = {
    position: "absolute",
    left: component.x,
    top: component.y,
    width: component.width,
    height: component.height,
    opacity: component.opacity,
    boxSizing: "border-box",
  };

  switch (component.type) {
    case "text":
      return {
        ...style,
        color: component.color,
        fontSize: component.fontSize,
        fontWeight: component.fontWeight,
        textAlign: component.align,
        lineHeight: 1.25,
        whiteSpace: "pre-wrap",
        overflow: "hidden",
        wordBreak: "break-word",
      };
    case "button":
      return {
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: component.background ?? "#0070F3",
        color: component.color,
        fontSize: component.fontSize,
        fontWeight: component.fontWeight,
        borderRadius: component.radius,
        textAlign: "center",
        padding: component.padding,
        overflow: "hidden",
      };
    case "input":
      return {
        ...style,
        display: "flex",
        alignItems: "center",
        background: component.background ?? "#F5F5F5",
        color: component.color,
        fontSize: component.fontSize,
        fontWeight: component.fontWeight,
        borderRadius: component.radius,
        padding: component.padding,
        overflow: "hidden",
        border: "1px solid rgba(127,127,127,0.25)",
      };
    case "card":
      return {
        ...style,
        background: component.background ?? "#FFFFFF",
        color: component.color,
        fontSize: component.fontSize,
        fontWeight: component.fontWeight,
        borderRadius: component.radius,
        padding: component.padding,
        whiteSpace: "pre-wrap",
        lineHeight: 1.5,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      };
    case "image":
      return {
        ...style,
        background: component.background ?? "#EAF2FE",
        backgroundImage: component.imageUrl ? `url("${component.imageUrl}")` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        borderRadius: component.radius,
        overflow: "hidden",
      };
  }
}

/** componentStyle without positioning — for nesting inside an editor wrapper. */
export function componentBodyStyle(component: DuelComponent): CSSProperties {
  const { position: _position, left: _left, top: _top, width: _width, height: _height, ...rest } =
    componentStyle(component);
  return { ...rest, width: "100%", height: "100%" };
}

/** Renders a design to a <canvas> at the given pixel ratio. */
export function renderDesignToCanvas(design: DuelDesign, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = design.frame.width * scale;
  canvas.height = design.frame.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, design.frame.width, design.frame.height);

  const sorted = [...design.components].sort((a, b) => {
    const order = (type: DuelComponentType) => (type === "card" || type === "image" ? 0 : type === "text" ? 2 : 1);
    return order(a.type) - order(b.type);
  });

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  for (const component of sorted) {
    const { x, y, width, height } = component;
    ctx.globalAlpha = component.opacity;

    if (component.type === "image") {
      const bg = component.background ?? "#EAF2FE";
      ctx.fillStyle = bg;
      roundRect(x, y, width, height, component.radius);
      ctx.fill();
      if (component.imageUrl) {
        const img = new Image();
        img.src = component.imageUrl;
        try {
          ctx.save();
          roundRect(x, y, width, height, component.radius);
          ctx.clip();
          ctx.drawImage(img, x, y, width, height);
          ctx.restore();
        } catch {
          // image may not have loaded yet — background stands in
        }
      }
    } else {
      const hasFill = component.type === "button" || component.type === "card" || component.type === "input";
      const fill = component.background ?? (hasFill ? "#FFFFFF" : "transparent");
      if (hasFill) {
        ctx.fillStyle = fill;
        roundRect(x, y, width, height, component.radius);
        ctx.fill();
      }

      if (component.text) {
        const textAlign = component.align === "center" ? "center" : component.align === "right" ? "right" : "left";
        ctx.fillStyle = component.color;
        ctx.font = `${component.fontWeight} ${component.fontSize}px Geist, -apple-system, system-ui, sans-serif`;
        ctx.textAlign = textAlign;
        ctx.textBaseline = "top";

        const paddingX = component.padding || 0;
        const paddingY = component.padding ? Math.max(6, component.padding * 0.35) : 0;
        const maxWidth = width - paddingX * 2;
        const lines = component.text.split("\n");
        const maxLines = Math.max(1, Math.floor((height - paddingY * 2) / (component.fontSize * 1.25)));
        const visibleLines = lines.slice(0, maxLines);

        const baseX = textAlign === "center" ? x + width / 2 : textAlign === "right" ? x + width - paddingX : x + paddingX;
        let cursorY = y + paddingY;

        if (component.type === "button" || component.type === "input") {
          const totalHeight = visibleLines.length * component.fontSize * 1.25;
          cursorY = y + Math.max(paddingY, (height - totalHeight) / 2);
        }

        for (const line of visibleLines) {
          let text = line;
          const metrics = ctx.measureText(text);
          if (metrics.width > maxWidth) {
            let clipped = text;
            while (clipped.length > 0 && ctx.measureText(clipped + "…").width > maxWidth) {
              clipped = clipped.slice(0, -1);
            }
            text = clipped + "…";
          }
          ctx.fillText(text, baseX, cursorY, maxWidth);
          cursorY += component.fontSize * 1.25;
        }
      }
    }
  }

  ctx.globalAlpha = 1;
  return canvas;
}

export function designToDataUrl(design: DuelDesign, scale = 2): string | null {
  try {
    return renderDesignToCanvas(design, scale).toDataURL("image/png");
  } catch {
    return null;
  }
}

export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.round(total));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}