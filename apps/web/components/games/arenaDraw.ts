import { ARENA, BUILDINGS, CORE, type BotWire } from "@/lib/games/arenaTypes";

const INK = "#2a2620";
const PAPER = "#f6efdc";
const CREAM = "#fffdf4";
const SHADOW = "rgba(42,38,32,0.14)";

export interface ViewPlayer {
  id: string;
  handle: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  alive: boolean;
  hp: number;
  self: boolean;
}

export interface ViewBullet {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface ViewFrame {
  players: Record<string, ViewPlayer>;
  bots: BotWire[];
  botBullets: Array<{ x: number; y: number; vx: number; vy: number }>;
  bullets: ViewBullet[];
  coreHp: number;
  tMs: number;
}

export interface Camera {
  scale: number;
  ox: number; // CSS px
  oy: number;
}

/** Build a camera that fits the whole paper arena into the canvas. */
export function fitCamera(cssW: number, cssH: number, pad = 26): Camera {
  const scale = Math.max(0.05, Math.min((cssW - pad * 2) / ARENA.w, (cssH - pad * 2) / ARENA.h));
  const ox = (cssW - ARENA.w * scale) / 2;
  const oy = (cssH - ARENA.h * scale) / 2;
  return { scale, ox, oy };
}

let gridPattern: CanvasPattern | null = null;

function makeGrid(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (gridPattern) return gridPattern;
  const size = 24;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const octx = off.getContext("2d");
  if (!octx) return null;
  octx.fillStyle = "rgba(42,38,32,0.09)";
  octx.beginPath();
  octx.arc(size / 2, size / 2, 1.1, 0, Math.PI * 2);
  octx.fill();
  gridPattern = ctx.createPattern(off, "repeat");
  return gridPattern;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  frame: ViewFrame,
  tMs: number,
): void {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, cssW, cssH);

  // Dotted graph-paper grid.
  const grid = makeGrid(ctx);
  if (grid) {
    ctx.fillStyle = grid;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  const cam = fitCamera(cssW, cssH);
  ctx.save();
  ctx.translate(cam.ox, cam.oy);
  ctx.scale(cam.scale, cam.scale);

  // Red "cut here" margin frame like a wireframe sheet.
  ctx.save();
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = "rgba(214,69,69,0.55)";
  ctx.lineWidth = 2 / cam.scale;
  ctx.strokeRect(10, 10, ARENA.w - 20, ARENA.h - 20);
  ctx.restore();

  // Annotation corners.
  ctx.fillStyle = "rgba(214,69,69,0.9)";
  ctx.font = `${13 / cam.scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText("PAPER ARENA v0.1 — FOLD ALONG DOTTED LINE", 22, 30);
  ctx.fillText("✂", ARENA.w - 30, 30);

  drawBuildings(ctx, cam.scale);
  drawCore(ctx, cam.scale, frame.coreHp);

  // Bot bullets (red ink dots).
  ctx.fillStyle = "#d64545";
  for (const b of frame.botBullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player bullets (pencil-coloured tracers).
  ctx.lineCap = "round";
  for (const b of frame.bullets) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }

  // Bots.
  for (const bot of frame.bots) {
    drawBot(ctx, bot, tMs, cam.scale);
  }

  // Players (last — on top).
  const list = Object.values(frame.players);
  list.sort((a, b) => (a.self ? 1 : 0) - (b.self ? 1 : 0));
  for (const p of list) drawPlayer(ctx, p, cam.scale, tMs);

  ctx.restore();
}

function drawBuildings(ctx: CanvasRenderingContext2D, s: number): void {
  for (const b of BUILDINGS) {
    // Drop shadow.
    ctx.fillStyle = SHADOW;
    ctx.fillRect(b.x + 7, b.y + 8, b.w, b.h);
    // Paper body.
    ctx.fillStyle = CREAM;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Ink outline.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2 / s;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    // Inner dashed guide.
    ctx.save();
    ctx.setLineDash([6 / s, 6 / s]);
    ctx.lineWidth = 1.4 / s;
    ctx.strokeStyle = "rgba(42,38,32,0.5)";
    ctx.strokeRect(b.x + 9 / s, b.y + 9 / s, b.w - 18 / s, b.h - 18 / s);
    ctx.restore();

    // Window grid (2×3) — little paper cut-outs.
    ctx.fillStyle = "rgba(42,38,32,0.16)";
    const cols = 3;
    const rows = 2;
    const gw = (b.w - 36 / s) / cols;
    const gh = (b.h - 40 / s) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        ctx.fillRect(b.x + 12 / s + i * gw + gw * 0.22, b.y + 16 / s + j * gh + gh * 0.28, gw * 0.55, gh * 0.45);
      }
    }
    // Door.
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6 / s;
    const dw = 22 / s;
    const dh = 26 / s;
    ctx.fillRect(b.x + b.w / 2 - dw / 2, b.y + b.h - dh, dw, dh);
    ctx.strokeRect(b.x + b.w / 2 - dw / 2, b.y + b.h - dh, dw, dh);
  }
}

function drawCore(ctx: CanvasRenderingContext2D, s: number, hp: number): void {
  const cx = ARENA.w / 2 - CORE.size / 2;
  const cy = ARENA.h / 2 - CORE.size / 2;
  const max = CORE.maxHp;

  ctx.fillStyle = SHADOW;
  ctx.fillRect(cx + 6, cy + 7, CORE.size, CORE.size);
  ctx.fillStyle = hp > max * 0.3 ? CREAM : "#fbe3e3";
  ctx.fillRect(cx, cy, CORE.size, CORE.size);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3 / s;
  ctx.strokeRect(cx, cy, CORE.size, CORE.size);

  // Battlements.
  ctx.fillStyle = INK;
  const t = 8 / s;
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(cx + 4 + i * ((CORE.size - 12 / s) / 4), cy - t, (CORE.size - 12 / s) / 4 - 4 / s, t);
  }

  // Flag.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2 / s;
  ctx.beginPath();
  ctx.moveTo(cx + CORE.size / 2, cy - t);
  ctx.lineTo(cx + CORE.size / 2, cy - t - 26 / s);
  ctx.stroke();
  ctx.fillStyle = "#d64545";
  ctx.beginPath();
  ctx.moveTo(cx + CORE.size / 2, cy - t - 26 / s);
  ctx.lineTo(cx + CORE.size / 2 + 18 / s, cy - t - 19 / s);
  ctx.lineTo(cx + CORE.size / 2, cy - t - 12 / s);
  ctx.closePath();
  ctx.fill();

  // Label.
  ctx.fillStyle = INK;
  ctx.font = `700 ${13 / s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.fillText("PAPER CORE", cx + CORE.size / 2, cy + CORE.size / 2 + 5 / s);
  ctx.textAlign = "start";
}

function drawBot(ctx: CanvasRenderingContext2D, bot: BotWire, tMs: number, s: number): void {
  const bob = Math.sin(tMs / 260 + bot.id * 1.9) * 1.6;
  const r = bot.kind === "runner" ? 11 : 15;
  const x = bot.x;
  const y = bot.y + bob;

  // Feet/leg lines.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6 / s;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.5, y + r * 0.9);
  ctx.lineTo(x - r * 0.7, y + r + 4 / s);
  ctx.moveTo(x + r * 0.5, y + r * 0.9);
  ctx.lineTo(x + r * 0.7, y + r + 4 / s);
  ctx.stroke();

  // Shadow blob.
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y + r + 6 / s, r * 0.9, 3.5 / s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Antenna.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6 / s;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y - r - 7 / s);
  ctx.stroke();
  ctx.fillStyle = "#d64545";
  ctx.beginPath();
  ctx.arc(x, y - r - 8.5 / s, 2.4 / s, 0, Math.PI * 2);
  ctx.fill();

  // Body.
  ctx.fillStyle = bot.flash ? "#ffffff" : "#e9e2cd";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2 / s;
  if (bot.kind === "runner") {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    roundRect(ctx, x - r, y - r * 0.9, r * 2, r * 1.8, 5 / s);
    ctx.fill();
    ctx.stroke();
  }

  // Eyes.
  ctx.fillStyle = "#26221a";
  const eyeY = y - r * 0.15;
  ctx.beginPath();
  ctx.arc(x - r * 0.38, eyeY, 2.6 / s, 0, Math.PI * 2);
  ctx.arc(x + r * 0.38, eyeY, 2.6 / s, 0, Math.PI * 2);
  ctx.fill();
  // Mouth.
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y + r * 0.55);
  ctx.lineTo(x + r * 0.4, y + r * 0.55);
  ctx.stroke();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: ViewPlayer, s: number, tMs: number): void {
  const r = 15;
  const x = p.x;
  const y = p.y;
  const live = p.alive;

  if (live) {
    // Aim guide (dashed pencil line).
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2 / s;
    ctx.setLineDash([7 / s, 7 / s]);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(p.angle) * (r + 4), y + Math.sin(p.angle) * (r + 4));
    ctx.lineTo(x + Math.cos(p.angle) * (r + 34 / s), y + Math.sin(p.angle) * (r + 34 / s));
    ctx.stroke();
    ctx.restore();
  }

  // Shadow.
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, y + r + 5 / s, r * 0.95, 4 / s, 0, 0, Math.PI * 2);
  ctx.fill();

  const wiggle = p.self ? Math.sin(tMs / 140) * 0.6 : 0;

  // Colored pencil ring.
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 3.4 / s;
  ctx.beginPath();
  ctx.arc(x, y + wiggle, r + 3.5 / s, 0, Math.PI * 2);
  ctx.stroke();

  // Paper tag body.
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.arc(x, y + wiggle, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2 / s;
  ctx.stroke();

  // Initial.
  ctx.fillStyle = INK;
  ctx.font = `700 ${13 / s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.handle.charAt(0).toUpperCase(), x, y + wiggle + 0.5);
  ctx.textBaseline = "alphabetic";

  // Name tag.
  ctx.font = `600 ${11 / s}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = p.self ? INK : "rgba(42,38,32,0.75)";
  ctx.fillText(p.self ? `${p.handle} (you)` : p.handle, x, y - r - 16 / s);

  // HP pips (little paper squares).
  const pip = 5 / s;
  const total = Math.max(p.hp, 0);
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < p.hp ? p.color : "rgba(42,38,32,0.2)";
    ctx.fillRect(x + (i - (total - 1) / 2) * (pip + 2 / s) - pip / 2, y + r + 9 / s, pip, pip);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
