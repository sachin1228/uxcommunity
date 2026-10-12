"use client";

import { useEffect, useRef } from "react";

/**
 * Height of the dotted band. The texture fades out by ~200px (the
 * `grid-dots-fade` mask) and stays invisible below, so the canvas only needs
 * to cover the part of the page where dots can ever be seen — with a little
 * room for dots pushed downward by the pointer.
 */
const BAND_HEIGHT = 240;

/** Pointer influence, as multiples of the grid spacing. */
const POINTER_RADIUS_FACTOR = 12;
const MAX_PUSH_FACTOR = 3;

/** How much the dots under the pointer brighten at its centre. */
const GLOW_GAIN = 1.6;

/** Per-frame easing of dots toward their targets — snappy, settles in ~0.3s. */
const FOLLOW = 0.18;

interface Dot {
  x: number;
  y: number;
  /** Current displacement from the resting position. */
  ox: number;
  oy: number;
  /** 0..1 pointer-proximity light. */
  glow: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string, fallback: Rgba): Rgba {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(value);
  if (!match) return fallback;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * The profile page's dotted backdrop. Renders the same dot grid the
 * `.grid-dots` texture draws (same spacing, dot size, colour and fade mask —
 * all read from the CSS custom properties), but on a canvas, so the dots near
 * the pointer can be pushed away and lit while the pointer is over the
 * texture, easing back to rest when it leaves. The resting frame is
 * pixel-for-pixel the old texture; idle pages draw one frame and no loop runs.
 */
export function DotField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const styles = getComputedStyle(canvas);
    const spacing = Number.parseFloat(styles.getPropertyValue("--grid-size")) || 8;
    const base = parseColor(styles.getPropertyValue("--grid-dot-color"), { r: 255, g: 255, b: 255, a: 0.14 });
    const pointerRadius = spacing * POINTER_RADIUS_FACTOR;
    const maxPush = spacing * MAX_PUSH_FACTOR;
    const faintFill = `rgba(${base.r}, ${base.g}, ${base.b}, ${base.a})`;

    let dots: Dot[] = [];
    let width = 0;
    let cursorX = Number.NEGATIVE_INFINITY;
    let cursorY = Number.NEGATIVE_INFINITY;
    let hovering = false;
    let frame = 0;

    function draw() {
      context!.clearRect(0, 0, width, BAND_HEIGHT);
      // Resting dots go out as a single path; only the lit ones pay per-dot fill.
      context!.fillStyle = faintFill;
      context!.beginPath();
      for (const dot of dots) {
        if (dot.glow > 0.02) continue;
        context!.moveTo(dot.x + dot.ox + 1, dot.y + dot.oy);
        context!.arc(dot.x + dot.ox, dot.y + dot.oy, 1, 0, Math.PI * 2);
      }
      context!.fill();
      for (const dot of dots) {
        if (dot.glow <= 0.02) continue;
        const alpha = Math.min(1, base.a * (1 + GLOW_GAIN * dot.glow));
        context!.fillStyle = `rgba(${base.r}, ${base.g}, ${base.b}, ${alpha})`;
        context!.beginPath();
        context!.arc(dot.x + dot.ox, dot.y + dot.oy, 1, 0, Math.PI * 2);
        context!.fill();
      }
    }

    function step() {
      frame = 0;
      let moving = false;
      for (const dot of dots) {
        let targetX = 0;
        let targetY = 0;
        let targetGlow = 0;
        if (hovering) {
          const dx = dot.x - cursorX;
          const dy = dot.y - cursorY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < pointerRadius) {
            const falloff = 1 - distance / pointerRadius;
            if (distance > 0.5) {
              const push = falloff * falloff * maxPush;
              targetX = (dx / distance) * push;
              targetY = (dy / distance) * push;
            }
            targetGlow = falloff;
          }
        }
        dot.ox += (targetX - dot.ox) * FOLLOW;
        dot.oy += (targetY - dot.oy) * FOLLOW;
        dot.glow += (targetGlow - dot.glow) * FOLLOW;
        if (
          !moving &&
          (Math.abs(dot.ox - targetX) > 0.06 ||
            Math.abs(dot.oy - targetY) > 0.06 ||
            Math.abs(dot.glow - targetGlow) > 0.006)
        ) {
          moving = true;
        }
      }
      draw();
      if (moving) frame = requestAnimationFrame(step);
    }

    function kick() {
      if (!frame) frame = requestAnimationFrame(step);
    }

    function seed() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      width = rect.width;
      canvas!.width = Math.max(1, Math.round(rect.width * dpr));
      canvas!.height = Math.round(BAND_HEIGHT * dpr);
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      // Same lattice as the CSS texture: a dot at the centre of every tile.
      for (let y = spacing / 2; y < BAND_HEIGHT; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          dots.push({ x, y, ox: 0, oy: 0, glow: 0 });
        }
      }
      draw();
    }

    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= BAND_HEIGHT;
      if (!inside && !hovering) return;
      hovering = inside;
      cursorX = x;
      cursorY = y;
      kick();
    }

    function release() {
      if (!hovering) return;
      hovering = false;
      kick();
    }

    // Touch has no hover: a lift ends the touch that stirred the dots. Mouse
    // releases on leave/blur instead, so a click under the pointer keeps them lit.
    function onPointerUp(event: PointerEvent) {
      if (event.pointerType === "mouse") return;
      release();
    }

    const observer = new ResizeObserver(seed);
    observer.observe(canvas);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      window.addEventListener("pointercancel", onPointerUp, { passive: true });
      window.addEventListener("blur", release);
      document.documentElement.addEventListener("mouseleave", release);
    }

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", release);
      document.documentElement.removeEventListener("mouseleave", release);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="grid-dots-fade pointer-events-none absolute inset-x-0 top-0 w-full"
      style={{ height: BAND_HEIGHT }}
    />
  );
}
