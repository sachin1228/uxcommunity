/**
 * 3D designer-studio room engine (plain three.js — no extra addons).
 *
 * Handles: scene + furniture building, third-person follow camera with
 * damping + collision, WASD / touch movement, and network-driven avatars
 * for other real users in the room.
 *
 * Rendering is tuned for a "stylized multiplayer game + premium designer
 * studio" look: ACES tone mapping, PMREM environment lighting, layered
 * warm/cool lights, PBR materials with procedural wood/plaster textures,
 * soft shadow-mapped sunlight, and (on capable devices) SSAO + subtle bloom
 * post-processing. Furniture is loaded from optimized GLB assets generated
 * by `apps/web/scripts/generate-room-assets.mjs`.
 *
 * React (`DesignersRoom.tsx`) is only responsible for the HUD, voice (WebRTC)
 * and input plumbing — all three.js state lives here.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// ─── Room constants ───────────────────────────────────────────────────────────
const HALF_W = 12; // room half-width  (x: ±12)
const HALF_D = 9; // room half-depth   (z: ±9)
const WALL_H = 4.6;
const BASE_FOV = 72;
const SPRINT_FOV = 79;
// third-person follow camera rig
const CAM_DIST = 3.4; // orbit distance behind the player
const CAM_HEIGHT = 1.95; // camera height above the floor
const LOOK_Y = 1.45; // the point the camera frames (player torso)

/** Static furniture colliders (x, z, radius). Mirrors the GLB placement below. */
const COLLIDERS: ReadonlyArray<readonly [number, number, number]> = [
  [5.6, -4.4, 1.85], // sofa
  [4.3, -2.3, 0.95], // coffee table
  [-6.4, -2.4, 1.3], // desk A
  [-4.4, -2.2, 0.75], // chair A
  [7.4, 3.6, 1.3], // desk B
  [5.4, 3.8, 0.75], // chair B
  [-11.2, 2.0, 1.0], // bookshelf
  [10.6, -7.2, 0.64], // plant (big)
  [-10.8, 6.6, 0.52], // plant (small)
  [2.6, 5.9, 0.4], // floor lamp
];

const FURNITURE_ASSETS = [
  "sofa",
  "coffee-table",
  "desk",
  "monitor",
  "chair",
  "floor-lamp",
  "plant",
] as const;

export interface RemoteUserState {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  mic: boolean;
}

export interface FrameRemote {
  id: string;
  x: number;
  z: number;
  mic: boolean;
}

export interface FrameState {
  playerX: number;
  playerZ: number;
  playerHeading: number;
  remotes: FrameRemote[];
}

export interface RoomOptions {
  onFrame: (state: FrameState) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

interface Collider {
  x: number;
  z: number;
  r: number;
}

type Quality = "high" | "medium" | "low";

function detectQuality(): Quality {
  if (typeof window === "undefined") return "low";
  const mobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
  if (mobile) return "low";
  const cores = navigator.hardwareConcurrency || 4;
  if (cores >= 6 && window.devicePixelRatio <= 2) return "high";
  return "medium";
}

// ─── Texture helpers (all procedural — no network, tiny memory) ────────────────
interface WoodTextures {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

/** Wood-plank texture set (albedo + normal + roughness) for the floor. */
function makeWoodTextures(): WoodTextures {
  const S = 512;
  const rows = 5;
  const plankH = S / rows;

  const mapC = document.createElement("canvas");
  mapC.width = mapC.height = S;
  const mctx = mapC.getContext("2d")!;

  const normalC = document.createElement("canvas");
  normalC.width = normalC.height = S;
  const nctx = normalC.getContext("2d")!;
  nctx.fillStyle = "#808080";
  nctx.fillRect(0, 0, S, S);

  const roughC = document.createElement("canvas");
  roughC.width = roughC.height = S;
  const rctx = roughC.getContext("2d")!;

  for (let r = 0; r < rows; r++) {
    const tone = 44 + Math.random() * 8;
    const hue = 26 + Math.random() * 8;
    mctx.fillStyle = `hsl(${hue}, 38%, ${tone}%)`;
    mctx.fillRect(0, r * plankH, S, plankH);
    // per-board long-direction shading (each plank is individually toned)
    const grad = mctx.createLinearGradient(0, r * plankH, 0, r * plankH + plankH);
    grad.addColorStop(0, `hsla(${hue}, 38%, ${tone + 4}%, 0.45)`);
    grad.addColorStop(1, `hsla(${hue}, 38%, ${tone - 5}%, 0.45)`);
    mctx.fillStyle = grad;
    mctx.fillRect(0, r * plankH, S, plankH);

    // long wavy grain streaks (subtle — wood reads as satin, not zebra)
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * S;
      const y = r * plankH + Math.random() * plankH;
      const len = 30 + Math.random() * 70;
      mctx.strokeStyle = `hsla(${hue + 5}, 34%, ${tone - 10}%, ${0.05 + Math.random() * 0.08})`;
      mctx.lineWidth = 1.4;
      mctx.beginPath();
      mctx.moveTo(x, y);
      mctx.quadraticCurveTo(x + len / 2, y + (Math.random() - 0.5) * 8, x + len, y + (Math.random() - 0.5) * 6);
      mctx.stroke();
    }
    // occasional knot
    if (Math.random() > 0.55) {
      const kx = 50 + Math.random() * (S - 100);
      const ky = r * plankH + Math.random() * plankH * 0.5;
      mctx.fillStyle = `hsla(${hue}, 42%, ${tone - 16}%, 0.75)`;
      mctx.beginPath();
      mctx.ellipse(kx, ky, 3.5, 6, 0, 0, Math.PI * 2);
      mctx.fill();
      mctx.fillStyle = `hsla(${hue}, 42%, ${tone - 22}%, 0.85)`;
      mctx.beginPath();
      mctx.ellipse(kx, ky, 1.6, 3.5, 0, 0, Math.PI * 2);
      mctx.fill();
    }

    // seams: recessed groove at the top of each board + a staggered butt
    // joint mid-board so planks read as individual boards, not a grid
    const seamY = r * plankH;
    mctx.fillStyle = `hsla(${hue}, 30%, 16%, 0.5)`;
    mctx.fillRect(0, seamY, S, 2.5);
    nctx.fillStyle = "#5a5a5a";
    nctx.fillRect(0, seamY + 1, S, 1.2);
    const joint = Math.random() * (S * 0.6) + S * 0.2;
    mctx.fillRect(joint - 1, seamY, 2.5, plankH);
    nctx.fillRect(joint, seamY + 1, 1.2, plankH);

    // per-board roughness variation (satin finish)
    rctx.fillStyle = Math.random() > 0.5 ? "#b4b4b4" : "#9e9e9e";
    rctx.fillRect(0, seamY, S, plankH);
  }

  const map = new THREE.CanvasTexture(mapC);
  const normal = new THREE.CanvasTexture(normalC);
  const rough = new THREE.CanvasTexture(roughC);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normal, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.4, 2.8);
  }
  return { map, normal, rough };
}

/** Subtle plaster noise + bump for the walls. */
function makePlasterTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f0e5d2";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    ctx.fillStyle = v > 0.5 ? "rgba(255,252,245,0.05)" : "rgba(120,100,80,0.04)";
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2.5, 2.5);
  }
  const n = document.createElement("canvas");
  n.width = n.height = 256;
  const nctx = n.getContext("2d")!;
  nctx.fillStyle = "#808080";
  nctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) {
    nctx.fillStyle = Math.random() > 0.5 ? "#7c7c7c" : "#858585";
    nctx.fillRect(Math.random() * 256, Math.random() * 256, 2.2, 2.2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(n);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
  }
  return { map, normal };
}

/** Circular rug: concentric bands + medallion + fiber normal. */
function makeRugTextures(): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const rings: Array<[number, string]> = [
    [256, "#3e6fb0"],
    [228, "#3a67a4"],
    [204, "#527fc2"],
    [182, "#4572b4"],
    [150, "#3e6fb0"],
    [128, "#5a86c6"],
    [98, "#3e6fb0"],
  ];
  for (const [r, col] of rings) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // medallion
  ctx.strokeStyle = "#d9e4f2";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(256, 256, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#3a67a4";
  ctx.beginPath();
  ctx.arc(256, 256, 34, 0, Math.PI * 2);
  ctx.fill();
  // subtle fiber noise (loose weave — not flat plastic)
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${Math.random() * 0.05})` : `rgba(0,0,20,${Math.random() * 0.04})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
  }
  const n = document.createElement("canvas");
  n.width = n.height = 512;
  const nctx = n.getContext("2d")!;
  nctx.fillStyle = "#808080";
  nctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2400; i++) {
    nctx.fillStyle = Math.random() > 0.5 ? "#7c7c7c" : "#858585";
    nctx.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(n);
  return { map, normal };
}

/** Soft radial gradient used for fake contact shadows under avatars. */
function makeBlobTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, "rgba(18,14,10,0.42)");
  g.addColorStop(0.55, "rgba(18,14,10,0.2)");
  g.addColorStop(1, "rgba(18,14,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeLabelTexture(name: string, role: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 128);
  // pill background
  const w = 490;
  const h = 92;
  const x = (512 - w) / 2;
  const y = (128 - h) / 2 + 6;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 46);
  ctx.fillStyle = "rgba(18,20,30,0.62)";
  ctx.fill();
  // accent dot
  ctx.beginPath();
  ctx.arc(x + 42, y + h / 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  // name
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 44px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + 66, y + 26);
  // role
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  ctx.fillText(role.toUpperCase(), x + 66, y + 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePosterTexture(palette: [string, string, string]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 256, 320);
  g.addColorStop(0, palette[0]);
  g.addColorStop(1, palette[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 320);
  // abstract shapes
  ctx.fillStyle = palette[2];
  ctx.beginPath();
  ctx.arc(128, 110, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(128, 110, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette[2];
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(40, 250);
  ctx.lineTo(128, 200);
  ctx.lineTo(216, 250);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("DESIGN", 128, 288);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMicTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 64);
  ctx.beginPath();
  ctx.roundRect(14, 10, 100, 44, 22);
  ctx.fillStyle = "rgba(24,138,74,0.92)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("MIC", 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#6fb6ff");
  g.addColorStop(0.7, "#bfe0ff");
  g.addColorStop(1, "#e8f3ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  // sun
  ctx.fillStyle = "#fff3c4";
  ctx.beginPath();
  ctx.arc(200, 34, 22, 0, Math.PI * 2);
  ctx.fill();
  // clouds
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const [cx, cy, cr] of [
    [60, 40, 14],
    [86, 46, 11],
    [160, 70, 12],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Procedural material detail (the GLB assets ship with flat color-only
// materials — no textures at all — so we enrich them per material name with
// albedo / normal / roughness detail derived from each material's base color.
// This keeps the palette coherent while adding surface richness.) ──────────────
type DetailKind = "wood" | "fabric" | "metal" | "leaf" | "felt" | "plastic";

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return [((h / 6) % 1) * 360, s, l];
}

function hsla(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

/** Maps a GLB material name → the detail texture recipe to enrich it with. */
function materialKind(name: string): DetailKind | null {
  const n = name.toLowerCase();
  if (n.includes("wood") || n.includes("book") || n.includes("drawer")) return "wood";
  if (n.includes("fabric") || n.includes("pillow") || n.includes("seat") || n.includes("shade")) return "fabric";
  if (n.includes("metal")) return "metal";
  if (n.includes("leaf") || n.includes("stem")) return "leaf";
  if (n.includes("deskmat")) return "felt";
  if (n.includes("plastic") || n.includes("keyboard") || n.includes("caster") || n.includes("cam")) return "plastic";
  return null;
}

interface DetailTextures {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

function makeDetailTextures(kind: DetailKind, base: string): DetailTextures {
  const [h, s, l] = hexToHsl(base);
  const S = 256;
  const mapC = document.createElement("canvas");
  mapC.width = mapC.height = S;
  const mctx = mapC.getContext("2d")!;
  const normalC = document.createElement("canvas");
  normalC.width = normalC.height = S;
  const nctx = normalC.getContext("2d")!;
  nctx.fillStyle = "#808080";
  nctx.fillRect(0, 0, S, S);
  const roughC = document.createElement("canvas");
  roughC.width = roughC.height = S;
  const rctx = roughC.getContext("2d")!;

  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  if (kind === "wood") {
    const sat = Math.max(0, s * 0.85);
    const light = Math.max(0.28, l - 0.03);
    mctx.fillStyle = hsla(h, sat, light);
    mctx.fillRect(0, 0, S, S);
    // vertical grain streaks
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * S;
      const w = rand(1, 4);
      const g = mctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, hsla(h, sat, light - rand(0.04, 0.12), 0.55));
      g.addColorStop(0.5, hsla(h, sat, light + rand(0.02, 0.06), 0.35));
      g.addColorStop(1, hsla(h, sat, light - rand(0.04, 0.1), 0.55));
      mctx.fillStyle = g;
      mctx.beginPath();
      mctx.moveTo(x, 0);
      mctx.quadraticCurveTo(x + w / 2, S / 2, x, S);
      mctx.lineTo(x + w, S);
      mctx.quadraticCurveTo(x + w / 2, S / 2, x + w, 0);
      mctx.closePath();
      mctx.fill();
    }
    // knots
    for (let i = 0; i < 3; i++) {
      const kx = Math.random() * S;
      const ky = Math.random() * S;
      for (let r = 6; r > 0; r -= 2) {
        mctx.fillStyle = hsla(h, sat, light - r * 0.014);
        mctx.beginPath();
        mctx.ellipse(kx, ky, r * 0.7, r, 0, 0, Math.PI * 2);
        mctx.fill();
      }
      nctx.fillStyle = "#5e5e5e";
      nctx.beginPath();
      nctx.ellipse(kx, ky, 6, 9, 0, 0, Math.PI * 2);
      nctx.fill();
    }
    // subtle long streaks on normal
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * S;
      nctx.strokeStyle = Math.random() > 0.5 ? "rgba(120,120,120,0.25)" : "rgba(95,95,95,0.25)";
      nctx.lineWidth = 1;
      nctx.beginPath();
      nctx.moveTo(x, 0);
      nctx.quadraticCurveTo(x + rand(-2, 2), S / 2, x, S);
      nctx.stroke();
    }
    rctx.fillStyle = "#b0b0b0";
    rctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) {
      rctx.fillStyle = "rgba(180,180,180,0.35)";
      rctx.fillRect(Math.random() * S, 0, 1.5, S);
    }
  } else if (kind === "fabric") {
    const sat = Math.max(0, s * 0.9);
    const light = Math.max(0.2, l - 0.02);
    mctx.fillStyle = hsla(h, sat, light);
    mctx.fillRect(0, 0, S, S);
    // woven dots
    for (let i = 0; i < 5200; i++) {
      const d = Math.random() > 0.5 ? 0.06 : -0.06;
      mctx.fillStyle = hsla(h, sat, light + d, 0.55);
      mctx.fillRect(Math.random() * S, Math.random() * S, 1.6, 1.6);
    }
    // diagonal weave
    for (let i = -S; i < S * 2; i += 4) {
      mctx.strokeStyle = "rgba(255,255,255,0.04)";
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.moveTo(i, 0);
      mctx.lineTo(i + S, S);
      mctx.stroke();
    }
    nctx.fillStyle = "#808080";
    nctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const v = Math.random() > 0.5 ? "#7a7a7a" : "#868686";
      nctx.fillStyle = v;
      nctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
    }
    rctx.fillStyle = "#d8d8d8";
    rctx.fillRect(0, 0, S, S);
  } else if (kind === "metal") {
    const sat = Math.min(s, 0.25);
    const light = Math.max(0.12, Math.min(0.55, l));
    mctx.fillStyle = hsla(h, sat, light);
    mctx.fillRect(0, 0, S, S);
    // brushed horizontal streaks
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * S;
      const g = mctx.createLinearGradient(0, y, S, y + 1);
      g.addColorStop(0, hsla(h, sat, light + rand(-0.08, -0.03), 0.4));
      g.addColorStop(0.5, hsla(h, sat, light + rand(0.03, 0.1), 0.5));
      g.addColorStop(1, hsla(h, sat, light + rand(-0.07, -0.02), 0.4));
      mctx.fillStyle = g;
      mctx.fillRect(0, y, S, 1);
    }
    nctx.fillStyle = "#808080";
    nctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * S;
      nctx.fillStyle = Math.random() > 0.5 ? "#7d7d7d" : "#838383";
      nctx.fillRect(0, y, S, 1);
    }
    rctx.fillStyle = "#8f8f8f";
    rctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 50; i++) {
      rctx.fillStyle = "rgba(160,160,160,0.3)";
      rctx.fillRect(0, Math.random() * S, S, 1);
    }
  } else if (kind === "leaf") {
    const light = Math.max(0.24, Math.min(0.5, l));
    mctx.fillStyle = hsla(h, Math.max(0.35, s), light);
    mctx.fillRect(0, 0, S, S);
    // vein network
    for (let i = 0; i < 7; i++) {
      const cx = Math.random() * S;
      const cy = Math.random() * S;
      mctx.strokeStyle = hsla(h, Math.max(0.3, s), light - 0.08, 0.4);
      mctx.lineWidth = 1.2;
      for (let a = 0; a < 4; a++) {
        const ang = Math.random() * Math.PI * 2;
        mctx.beginPath();
        mctx.moveTo(cx, cy);
        mctx.lineTo(cx + Math.cos(ang) * rand(30, 60), cy + Math.sin(ang) * rand(30, 60));
        mctx.stroke();
      }
    }
    for (let i = 0; i < 1500; i++) {
      mctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)";
      mctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    nctx.fillStyle = "#808080";
    nctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      nctx.strokeStyle = "#6e6e6e";
      nctx.lineWidth = 1;
      nctx.beginPath();
      nctx.moveTo(x, y);
      nctx.lineTo(x + rand(-30, 30), y + rand(-30, 30));
      nctx.stroke();
    }
    rctx.fillStyle = "#d5d5d5";
    rctx.fillRect(0, 0, S, S);
  } else if (kind === "felt") {
    mctx.fillStyle = hsla(h, s, l);
    mctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 4200; i++) {
      mctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
      mctx.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
    }
    nctx.fillStyle = "#7e7e7e";
    nctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2000; i++) {
      nctx.fillStyle = "#7a7a7a";
      nctx.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
    }
    rctx.fillStyle = "#dcdcdc";
    rctx.fillRect(0, 0, S, S);
  } else {
    // plastic — very subtle
    mctx.fillStyle = hsla(h, s, l);
    mctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      mctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.04)";
      mctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    nctx.fillStyle = "#808080";
    nctx.fillRect(0, 0, S, S);
    rctx.fillStyle = "#b8b8b8";
    rctx.fillRect(0, 0, S, S);
  }

  const map = new THREE.CanvasTexture(mapC);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(normalC);
  const rough = new THREE.CanvasTexture(roughC);
  for (const t of [map, normal, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
  }
  return { map, normal, rough };
}

function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 52%)`;
}

// ─── Remote (real user) avatar ──────────────────────────────────────────────────
interface RemoteAvatar {
  id: string;
  name: string;
  color: string;
  group: THREE.Group;
  label: THREE.Sprite;
  micBadge: THREE.Sprite;
  targetX: number;
  targetZ: number;
  targetHeading: number;
  x: number;
  z: number;
  heading: number;
  mic: boolean;
  phase: number;
}

function buildRemoteAvatar(id: string, name: string): RemoteAvatar {
  const group = new THREE.Group();
  const color = colorFromName(name);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: "#e6b98f", roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: "#20222e", roughness: 0.8 });

  // contact shadow blob so remote users feel grounded on the floor
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 20),
    new THREE.MeshBasicMaterial({
      map: makeBlobTexture(),
      transparent: true,
      depthWrite: false,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.012;
  group.add(blob);

  // body (slightly slimmer than NPCs so remote users read as "players")
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.5, 8, 16), bodyMat);
  body.position.y = 0.6;
  body.castShadow = true;
  group.add(body);

  const legGeo = new THREE.CapsuleGeometry(0.085, 0.4, 6, 12);
  const leftLeg = new THREE.Mesh(legGeo, bodyMat);
  leftLeg.position.set(-0.13, 0.28, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(legGeo, bodyMat);
  rightLeg.position.set(0.13, 0.28, 0);
  rightLeg.castShadow = true;
  group.add(leftLeg, rightLeg);

  const armGeo = new THREE.CapsuleGeometry(0.065, 0.34, 6, 12);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.38, 1.0, 0);
  leftArm.castShadow = true;
  const rightArm = new THREE.Mesh(armGeo, bodyMat);
  rightArm.position.set(0.38, 1.0, 0);
  rightArm.castShadow = true;
  group.add(leftArm, rightArm);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 20, 20), skinMat);
  head.position.y = 1.34;
  head.castShadow = true;
  group.add(head);

  // simple cap so remote users are instantly recognisable as players
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.12, 16), darkMat);
  cap.position.y = 1.5;
  cap.castShadow = true;
  group.add(cap);

  // name label
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeLabelTexture(name, "In the studio", color),
      transparent: true,
      depthWrite: false,
    })
  );
  label.scale.set(1.9, 0.475, 1);
  label.position.y = 2.12;
  group.add(label);

  // mic badge (visible when the user is transmitting)
  const micBadge = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeMicTexture(),
      transparent: true,
      depthWrite: false,
    })
  );
  micBadge.scale.set(0.62, 0.31, 1);
  micBadge.position.y = 1.8;
  micBadge.visible = false;
  group.add(micBadge);

  return {
    id,
    name,
    color,
    group,
    label,
    micBadge,
    targetX: 0,
    targetZ: 0,
    targetHeading: 0,
    x: 0,
    z: 0,
    heading: 0,
    mic: false,
    phase: Math.random() * Math.PI * 2,
  };
}

// ─── Room ──────────────────────────────────────────────────────────────────────
export class DesignersRoom {
  private container: HTMLElement;
  private opts: RoomOptions;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  private raf = 0;
  private disposed = false;

  private quality: Quality;

  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  // smoothed look targets (movement acceleration lives in updatePlayer)
  private lookYaw = 0;
  private lookPitch = 0;
  private velX = 0;
  private velZ = 0;
  private bobPhase = 0;
  private fov = BASE_FOV;
  // spawn near the door, scattered so people don't start inside each other
  private px = (Math.random() * 2 - 1) * 2.5;
  private pz = 4.6 + Math.random() * 2;

  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;

  private remotes = new Map<string, RemoteAvatar>();
  private colliders: Collider[] = [];

  // third-person rig state
  private camPos = new THREE.Vector3();
  private camInit = false;
  private playerBody: THREE.Group | null = null;

  private post: { composer: EffectComposer; ssao: SSAOPass | null; bloom: UnrealBloomPass | null } | null = null;

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: RoomOptions) {
    this.container = container;
    this.opts = opts;
    this.quality = detectQuality();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
        stencil: false,
      });
    } catch (err) {
      opts.onError("WebGL is not available in this browser.");
      throw err;
    }
    this.renderer = renderer;
    const cap = this.quality === "low" ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "crosshair";
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#eadfc6");
    this.scene.fog = new THREE.Fog("#eadfc6", 24, 50);

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 120);
    this.camera.rotation.order = "YXZ";

    this.buildEnvironment();
    this.buildLights();
    this.buildRoomShell();
    this.buildDecor();
    this.buildPlayerBody();

    for (const [x, z, r] of COLLIDERS) this.addCollider(x, z, r);

    // start the follow rig parked behind the player
    this.camPos.set(this.px + Math.sin(this.yaw) * CAM_DIST, CAM_HEIGHT, this.pz + Math.cos(this.yaw) * CAM_DIST);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    renderer.domElement.addEventListener("contextmenu", this.onContextMenu);

    void this.loadFurniture();
    void this.initPostProcessing();
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  start() {
    if (this.raf) return;
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 0.05);
      const t = this.timer.getElapsed();
      this.updatePlayer(dt);
      this.updateRemotes(dt, t);
      if (this.post) {
        this.post.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
      this.emitFrame();
      if (!this.readyEmitted) {
        this.readyEmitted = true;
        this.opts.onReady();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    this.timer.dispose();
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    this.resizeObserver.disconnect();
    this.post?.composer.dispose();
    this.disposeScene();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  /** Touch/drag: directional vector in local space, both in [-1, 1]. */
  setTouchMove(fx: number, fz: number) {
    this.touchMoveX = Math.max(-1, Math.min(1, fx));
    this.touchMoveZ = Math.max(-1, Math.min(1, fz));
  }

  /** Incremental look delta in pixels (drag to look — desktop and touch). */
  addLook(dx: number, dy: number) {
    this.lookYaw -= dx * 0.0032;
    this.lookPitch -= dy * 0.0032;
    this.lookPitch = Math.max(-1.35, Math.min(1.35, this.lookPitch));
  }

  // ── Internals ────────────────────────────────────────────────────────────────
  private readyEmitted = false;

  private emitFrame() {
    this.opts.onFrame({
      playerX: this.px,
      playerZ: this.pz,
      playerHeading: this.yaw,
      remotes: [...this.remotes.values()].map((r) => ({
        id: r.id,
        x: r.x,
        z: r.z,
        mic: r.mic,
      })),
    });
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.composer.setSize(w, h);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "shift", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  // ── Rendering pipeline ───────────────────────────────────────────────────────
  /** Procedural studio environment map → PBR reflections + indirect light. */
  private buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.3;
  }

  /** Layered lighting: sky fill + sun through the window + warm interior bounce. */
  private buildLights() {
    // indirect base: cool sky above, warm floor bounce below
    const hemi = new THREE.HemisphereLight(0xdbe7ff, 0x8f8170, 0.4);
    this.scene.add(hemi);

    // warm key sun streaming through the back window — the main shadow caster
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.6);
    sun.position.set(-3, 9, -17);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 42;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // cool sky fill from the window side — believable back-wall depth
    const skyFill = new THREE.DirectionalLight(0xbcd8ff, 0.55);
    skyFill.position.set(0, 6, -8);
    this.scene.add(skyFill);

    // faint warm bounce from the room's opposite corner so shadows don't crush
    const fill = new THREE.DirectionalLight(0xffe9d0, 0.16);
    fill.position.set(6, 4, 8);
    this.scene.add(fill);
  }

  private addCollider(x: number, z: number, r: number) {
    this.colliders.push({ x, z, r });
  }

  // ── Room shell (floor / walls / trims / window / door) ──────────────────────
  private buildRoomShell() {
    const wood = makeWoodTextures();
    const floorMat = new THREE.MeshStandardMaterial({
      map: wood.map,
      normalMap: wood.normal,
      roughnessMap: wood.rough,
      roughness: 1,
      metalness: 0,
    });
    const plaster = makePlasterTextures();
    const wallMat = new THREE.MeshStandardMaterial({
      map: plaster.map,
      normalMap: plaster.normal,
      roughness: 0.96,
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: "#f0e4cf", roughness: 0.9 });

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // walls
    const mkWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      wall.position.set(x, y, z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.scene.add(wall);
    };
    mkWall(HALF_W * 2, WALL_H, 0.3, 0, WALL_H / 2, -HALF_D); // back
    mkWall(HALF_W * 2, WALL_H, 0.3, 0, WALL_H / 2, HALF_D); // front
    mkWall(0.3, WALL_H, HALF_D * 2, -HALF_W, WALL_H / 2, 0); // left
    mkWall(0.3, WALL_H, HALF_D * 2, HALF_W, WALL_H / 2, 0); // right

    // ceiling (subtly lighter than walls)
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: "#fff8ec", roughness: 1 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    ceil.receiveShadow = true;
    this.scene.add(ceil);

    // baseboards + crown molding — cheap architectural depth
    const mkTrim = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trimMat);
      t.position.set(x, y, z);
      t.castShadow = true;
      t.receiveShadow = true;
      this.scene.add(t);
    };
    const bbY = 0.1;
    mkTrim(HALF_W * 2 - 0.6, 0.18, 0.14, 0, bbY, -HALF_D + 0.16);
    mkTrim(HALF_W * 2 - 0.6, 0.18, 0.14, 0, bbY, HALF_D - 0.16);
    mkTrim(0.14, 0.18, HALF_D * 2 - 0.6, -HALF_W + 0.16, bbY, 0);
    mkTrim(0.14, 0.18, HALF_D * 2 - 0.6, HALF_W - 0.16, bbY, 0);
    const crownY = WALL_H - 0.1;
    mkTrim(HALF_W * 2 - 0.6, 0.12, 0.14, 0, crownY, -HALF_D + 0.16);
    mkTrim(HALF_W * 2 - 0.6, 0.12, 0.14, 0, crownY, HALF_D - 0.16);
    mkTrim(0.14, 0.12, HALF_D * 2 - 0.6, -HALF_W + 0.16, crownY, 0);
    mkTrim(0.14, 0.12, HALF_D * 2 - 0.6, HALF_W - 0.16, crownY, 0);

    // window on the back wall + sky outside
    const winFrame = new THREE.Mesh(
      new THREE.BoxGeometry(9, 2.6, 0.24),
      new THREE.MeshStandardMaterial({ color: "#e8d7b8", roughness: 0.9 })
    );
    winFrame.position.set(0, 2.35, -HALF_D + 0.18);
    winFrame.castShadow = true;
    this.scene.add(winFrame);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#cfe8ff",
      transparent: true,
      opacity: 0.26,
      roughness: 0.06,
      metalness: 0.1,
      envMapIntensity: 1.8,
      side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 2.0), glassMat);
    glass.position.set(0, 2.35, -HALF_D + 0.34);
    this.scene.add(glass);

    // mullions
    const mullionMat = new THREE.MeshStandardMaterial({ color: "#efe2c8", roughness: 0.85 });
    const mkMullion = (w: number, h: number, d: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mullionMat);
      m.position.set(x, y, -HALF_D + 0.36);
      m.castShadow = true;
      this.scene.add(m);
    };
    mkMullion(0.09, 2.1, 0.05, -2.72, 2.35);
    mkMullion(0.09, 2.1, 0.05, 2.72, 2.35);
    mkMullion(8.3, 0.09, 0.05, 0, 1.36);
    mkMullion(8.3, 0.09, 0.05, 0, 3.34);
    // sill
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.12, 0.4),
      new THREE.MeshStandardMaterial({ color: "#f5ead4", roughness: 0.85 })
    );
    sill.position.set(0, 0.94, -HALF_D + 0.3);
    sill.castShadow = true;
    this.scene.add(sill);

    // curtains — soft fabric panels flanking the window
    const curtainMat = new THREE.MeshStandardMaterial({ color: "#d8c9ae", roughness: 1 });
    const curtainL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.9, 0.07), curtainMat);
    curtainL.position.set(-4.75, 1.88, -HALF_D + 0.1);
    curtainL.castShadow = true;
    this.scene.add(curtainL);
    const curtainR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.9, 0.07), curtainMat);
    curtainR.position.set(4.75, 1.88, -HALF_D + 0.1);
    curtainR.castShadow = true;
    this.scene.add(curtainR);
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 9.6, 10),
      new THREE.MeshStandardMaterial({ color: "#3a3a46", metalness: 0.7, roughness: 0.35 })
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 3.72, -HALF_D + 0.14);
    this.scene.add(rod);

    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 11),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture() })
    );
    sky.position.set(0, 3.4, -HALF_D - 3.6);
    this.scene.add(sky);

    // door on the front wall (paneled)
    const doorMat = new THREE.MeshStandardMaterial({ color: "#b98a5a", roughness: 0.8 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.2, 0.34), doorMat);
    door.position.set(-8.6, 1.6, HALF_D - 0.16);
    door.castShadow = true;
    door.receiveShadow = true;
    this.scene.add(door);
    const panelMat = new THREE.MeshStandardMaterial({ color: "#c69763", roughness: 0.85 });
    for (const py of [1.2, 2.2]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.62, 0.02), panelMat);
      panel.position.set(-8.6, py, HALF_D - 0.32);
      panel.castShadow = true;
      this.scene.add(panel);
    }
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshStandardMaterial({ color: "#c9a24b", metalness: 0.7, roughness: 0.3 })
    );
    knob.position.set(-8.6 + 0.7, 1.55, HALF_D - 0.28);
    this.scene.add(knob);

    // rug
    const rugTex = makeRugTextures();
    const rug = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.3, 0.03, 48),
      new THREE.MeshStandardMaterial({
        map: rugTex.map,
        normalMap: rugTex.normal,
        roughness: 1,
      })
    );
    rug.position.y = 0.02;
    rug.receiveShadow = true;
    this.scene.add(rug);
    const rugRim = new THREE.Mesh(
      new THREE.TorusGeometry(3.3, 0.035, 8, 48),
      new THREE.MeshStandardMaterial({ color: "#35598e", roughness: 1 })
    );
    rugRim.rotation.x = Math.PI / 2;
    rugRim.position.y = 0.045;
    this.scene.add(rugRim);
  }

  // ── Decor (procedural details that don't need GLBs) ─────────────────────────
  private buildDecor() {
    const std = (color: string, rough = 0.8) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough });
    const box = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      ry = 0
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };

    // ── bookshelf (left wall) ──
    const shX = -11.2;
    const shZ = 2.0;
    const shelfWood = std("#7a5230", 0.85);
    const shelfWoodLight = std("#8f6a44", 0.85);
    box(0.72, 2.7, 1.7, shelfWood, shX, 1.35, shZ);
    box(0.75, 0.12, 1.72, shelfWoodLight, shX, 0.1, shZ);
    for (const sy of [0.94, 1.64, 2.34]) {
      box(0.75, 0.1, 1.72, shelfWoodLight, shX, sy, shZ);
    }
    const bookColors = ["#c2574c", "#2f6fed", "#3fa06b", "#9a6ff0", "#f0a832", "#4a7c8a", "#e2574c"];
    for (let shelf = 0; shelf < 3; shelf++) {
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.34 + Math.random() * 0.22, 0.13),
          std(bookColors[(i + shelf) % bookColors.length], 0.9)
        );
        b.position.set(shX + 0.02, 0.42 + shelf * 0.7, shZ - 0.62 + i * 0.16);
        b.castShadow = true;
        this.scene.add(b);
      }
      // a leaning book
      const lean = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.38, 0.12),
        std(bookColors[(shelf * 3 + 1) % bookColors.length], 0.9)
      );
      lean.position.set(shX + 0.02, 0.4 + shelf * 0.7, shZ - 0.62 + 7 * 0.16 + 0.1);
      lean.rotation.z = 0.28;
      lean.castShadow = true;
      this.scene.add(lean);
    }
    // mini vase on the top shelf
    const vase = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      std("#e8d7b8", 0.5)
    );
    vase.scale.set(1, 1.15, 1);
    vase.position.set(shX + 0.05, 2.62, shZ - 0.35);
    vase.castShadow = true;
    this.scene.add(vase);

    // ── desk A accessories (cup, notepad, pen) ──
    const cupMat = std("#f2ede4", 0.7);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 12), cupMat);
    cup.position.set(-5.95, 0.99, -2.05);
    cup.castShadow = true;
    this.scene.add(cup);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.022, 0.008, 6, 12),
      cupMat
    );
    handle.position.set(-5.98, 0.99, -2.03);
    this.scene.add(handle);
    const pad = box(0.18, 0.012, 0.24, std("#faf7f0", 0.85), -6.85, 0.955, -2.7, 0.3);
    pad.receiveShadow = false;
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.16, 8),
      std("#20222e", 0.5)
    );
    pen.rotation.z = Math.PI / 2;
    pen.position.set(-6.82, 0.968, -2.63);
    pen.castShadow = true;
    this.scene.add(pen);

    // ── desk B accessories (stacked pads + phone) ──
    const padB1 = box(0.2, 0.012, 0.26, std("#ece7f4", 0.85), 6.95, 0.955, 3.1, -0.2);
    padB1.receiveShadow = false;
    const padB2 = box(0.18, 0.012, 0.24, std("#faf7f0", 0.85), 6.97, 0.968, 3.12, -0.2);
    padB2.receiveShadow = false;
    const phone = box(0.05, 0.01, 0.09, std("#20222e", 0.6), 7.85, 0.953, 3.85);
    phone.receiveShadow = false;

    // ── wall clock (back wall) ──
    const clockFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 28),
      std("#fdf9f0", 0.9)
    );
    clockFace.position.set(2.4, 3.35, -HALF_D + 0.21);
    this.scene.add(clockFace);
    const clockRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.02, 8, 28),
      std("#2b2b33", 0.5)
    );
    clockRim.position.set(2.4, 3.35, -HALF_D + 0.215);
    this.scene.add(clockRim);
    const clockHand = (ry: number, len: number) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.012, len, 0.01), std("#2b2b33", 0.6));
      h.position.set(2.4, 3.35, -HALF_D + 0.23);
      h.rotation.z = ry;
      this.scene.add(h);
    };
    clockHand(Math.PI / 2.6, 0.2);
    clockHand(Math.PI / 4, 0.14);

    // ── ceiling pendants ──
    const mkPendant = (x: number, z: number, intensity: number) => {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8),
        std("#23232b", 0.5)
      );
      cord.position.set(x, WALL_H - 0.27, z);
      this.scene.add(cord);
      const shade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.13, 0.3, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: "#fff2dd",
          roughness: 0.9,
          side: THREE.DoubleSide,
          emissive: "#fff2dd",
          emissiveIntensity: 0.35,
        })
      );
      shade.position.set(x, WALL_H - 0.68, z);
      shade.castShadow = true;
      this.scene.add(shade);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 10),
        new THREE.MeshBasicMaterial({ color: "#ffe9b8" })
      );
      glow.position.set(x, WALL_H - 0.82, z);
      this.scene.add(glow);
      const light = new THREE.PointLight(0xfff0d4, intensity, 16, 2);
      light.position.set(x, WALL_H - 0.84, z);
      this.scene.add(light);
    };
    mkPendant(0, 0, 26);
    mkPendant(-6, 2.5, 16);

    // ── posters (framed design work) ──
    const mkPoster = (
      w: number,
      h: number,
      palette: [string, string, string],
      x: number,
      y: number,
      z: number,
      ry: number
    ) => {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.04),
        std("#8a6a42", 0.8)
      );
      frame.position.set(x, y, z);
      frame.rotation.y = ry;
      frame.castShadow = true;
      this.scene.add(frame);
      // white mat between frame and art
      const n = { x: Math.sin(ry), z: Math.cos(ry) };
      const mat = new THREE.Mesh(
        new THREE.PlaneGeometry(w + 0.03, h + 0.03),
        std("#faf7f0", 0.9)
      );
      mat.position.set(x + n.x * 0.025, y, z + n.z * 0.025);
      mat.rotation.y = ry;
      this.scene.add(mat);
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: makePosterTexture(palette) })
      );
      art.position.set(x + n.x * 0.05, y, z + n.z * 0.05);
      art.rotation.y = ry;
      this.scene.add(art);
    };
    mkPoster(1.7, 2.1, ["#2f6fed", "#7fb5ff", "#ffd166"], -4, 2.4, -HALF_D + 0.2, 0);
    mkPoster(1.4, 1.75, ["#e2574c", "#ff9d8a", "#ffe9e5"], 3.4, 2.3, HALF_D - 0.2, Math.PI);
    mkPoster(1.4, 1.75, ["#3fa06b", "#8fd6a8", "#eafff1"], HALF_W - 0.2, 2.2, 4.2, -Math.PI / 2);
    mkPoster(1.5, 1.9, ["#9a6ff0", "#c9a9ff", "#fff0b3"], -2.2, 2.35, HALF_D - 0.2, Math.PI);
  }

  // ── Furniture (GLB assets + fallback) ───────────────────────────────────────
  private async loadFurniture() {
    const fallback = () => {
      if (this.disposed) return;
      this.buildFallbackFurniture();
    };
    try {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      if (this.disposed) return;
      const loader = new GLTFLoader();
      const load = (name: string) =>
        new Promise<readonly [string, THREE.Group]>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error(`timeout: ${name}`)), 8000);
          loader.loadAsync(`/designers/${name}.glb`).then(
            (gltf) => {
              window.clearTimeout(timer);
              resolve([name, gltf.scene]);
            },
            (err) => {
              window.clearTimeout(timer);
              reject(err);
            }
          );
        });
      const settled = await Promise.allSettled(FURNITURE_ASSETS.map((n) => load(n)));
      if (this.disposed) return;
      const assets = new Map<string, THREE.Group>();
      for (const r of settled) {
        if (r.status === "fulfilled") assets.set(r.value[0], r.value[1]);
      }
      // core seating/desk assets must exist for the full scene to make sense
      if (assets.has("sofa") && assets.has("desk") && assets.has("chair")) {
        this.placeAssets(assets);
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }

  /** Clone with per-mesh material instances so tints never leak between clones. */
  private cloneAsset(group: THREE.Group): THREE.Group {
    const clone = group.clone(true);
    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        mesh.material = (Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : mesh.material.clone()) as THREE.Material;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return clone;
  }

  private tint(group: THREE.Group, matName: string, color: string) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as THREE.Material).name === matName) {
          (m as THREE.MeshStandardMaterial).color.set(color);
        }
      }
    });
  }

  private makeScreenGlow(group: THREE.Group, color: string) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.name === "Screen") {
          mat.emissive.set(color);
          mat.emissiveIntensity = 1.5;
        }
      }
    });
  }

  /**
   * Enrich flat color-only GLB materials with procedural surface detail
   * derived from each material's base color (the assets ship texture-free,
   * so per-name detail makes them read as designed, not plain).
   */
  private enhanceMaterials(group: THREE.Group) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (!sm.isMeshStandardMaterial || sm.map) continue;
        const kind = materialKind(sm.name);
        if (!kind) continue;
        const { map, normal, rough } = makeDetailTextures(kind, sm.color.getStyle());
        sm.map = map;
        sm.normalMap = normal;
        sm.roughnessMap = rough;
        if (kind === "metal") {
          sm.envMapIntensity = 1.25;
          sm.roughness = Math.min(sm.roughness ?? 0.5, 0.5);
        } else if (kind === "wood") {
          sm.envMapIntensity = 0.7;
        } else if (kind === "leaf") {
          sm.side = THREE.DoubleSide;
          sm.envMapIntensity = 0.5;
          sm.emissive = new THREE.Color(sm.color).multiplyScalar(0.08);
        } else if (kind === "fabric" || kind === "felt") {
          sm.envMapIntensity = 0.35;
        }
        sm.needsUpdate = true;
      }
    });
  }

  /** Soft fake contact shadow that grounds furniture on the floor. */
  private addContactShadow(x: number, z: number, w: number, d: number) {
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        map: makeBlobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(x, 0.014, z);
    blob.renderOrder = 1;
    this.scene.add(blob);
  }

  /** Minimal player avatar body that the follow camera frames. */
  private buildPlayerBody() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: "#5b6b8c", roughness: 0.75 });
    const skinMat = new THREE.MeshStandardMaterial({ color: "#e6b98f", roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.5, 8, 16), bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 20, 20), skinMat);
    head.position.y = 1.34;
    head.castShadow = true;
    g.add(head);
    // subtle ring so "you" are distinguishable from remote avatars
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 24),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    this.playerBody = g;
    this.scene.add(g);
  }

  private placeAssets(assets: Map<string, THREE.Group>) {
    const place = (name: string, x: number, z: number, ry = 0, scale = 1, y = 0) => {
      const src = assets.get(name);
      if (!src) return;
      const g = this.cloneAsset(src);
      this.enhanceMaterials(g);
      g.position.set(x, y, z);
      g.rotation.y = ry;
      g.scale.setScalar(scale);
      this.scene.add(g);
    };

    place("sofa", 5.6, -4.4);
    place("coffee-table", 4.3, -2.3);

    place("desk", -6.4, -2.4);
    place("chair", -4.4, -2.2, Math.PI / 2); // faces -X (toward desk)

    // desk B — mirrored layout, purple tint
    const deskB = assets.get("desk");
    if (deskB) {
      const clone = this.cloneAsset(deskB);
      this.tint(clone, "wood", "#6e5a86");
      this.tint(clone, "woodDark", "#4c3d60");
      this.tint(clone, "drawer", "#7a658f");
      this.enhanceMaterials(clone);
      clone.position.set(7.4, 0, 3.6);
      this.scene.add(clone);
    }
    place("chair", 5.4, 3.8, -Math.PI / 2); // faces +X (toward desk)

    place("floor-lamp", 2.6, 5.9);
    const lampLight = new THREE.PointLight(0xffc98f, 13, 11, 2);
    lampLight.position.set(2.6, 1.88, 5.9);
    this.scene.add(lampLight);

    place("plant", 10.6, -7.2, 0, 1.15);
    place("plant", -10.8, 6.6, 0, 0.95);
    place("plant", 3.45, -1.8, 0.6, 0.22, 0.95); // tiny plant on the coffee table

    // monitors — placed once each, with an emissive screen glow
    const monitorA = assets.get("monitor");
    if (monitorA) {
      const a = this.cloneAsset(monitorA);
      a.position.set(-6.3, 0.945, -2.4);
      a.rotation.y = -Math.PI / 2;
      this.enhanceMaterials(a);
      this.makeScreenGlow(a, "#7fb5ff");
      this.scene.add(a);
      const b = this.cloneAsset(monitorA);
      b.position.set(7.3, 0.945, 3.6);
      b.rotation.y = Math.PI / 2;
      this.enhanceMaterials(b);
      this.makeScreenGlow(b, "#ffb37f");
      this.scene.add(b);
    }

    // fake contact shadows ground every piece of furniture
    this.addContactShadow(5.6, -4.4, 3.3, 1.5); // sofa
    this.addContactShadow(4.3, -2.3, 1.7, 1.05); // coffee table
    this.addContactShadow(-6.4, -2.4, 2.3, 1.15); // desk A
    this.addContactShadow(-4.4, -2.2, 0.85, 0.85); // chair A
    this.addContactShadow(7.4, 3.6, 2.3, 1.15); // desk B
    this.addContactShadow(5.4, 3.8, 0.85, 0.85); // chair B
    this.addContactShadow(2.6, 5.9, 0.7, 0.7); // floor lamp
    this.addContactShadow(10.6, -7.2, 1.3, 1.3); // plant (big)
    this.addContactShadow(-10.8, 6.6, 1.1, 1.1); // plant (small)
    this.addContactShadow(-11.2, 2.0, 1.1, 1.9); // bookshelf
  }

  /** Procedural fallback used when GLB loading fails (keeps the room furnished). */
  private buildFallbackFurniture() {
    const std = (color: string, rough = 0.8) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough });
    const box = (
      w: number,
      h: number,
      d: number,
      color: string,
      x: number,
      y: number,
      z: number,
      rough = 0.8,
      shadow = true
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color, rough));
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };

    // sofa
    const sofaX = 5.6;
    const sofaZ = -4.4;
    box(3.0, 0.55, 1.15, "#4a7c8a", sofaX, 0.45, sofaZ, 0.9);
    box(3.0, 0.75, 0.32, "#3f6b77", sofaX, 1.0, sofaZ - 0.42, 0.9);
    box(0.42, 0.75, 1.15, "#3f6b77", sofaX - 1.35, 0.95, sofaZ, 0.9);
    box(0.42, 0.75, 1.15, "#3f6b77", sofaX + 1.35, 0.95, sofaZ, 0.9);
    box(1.0, 0.24, 0.85, "#d8e4e6", sofaX - 0.72, 0.82, sofaZ - 0.05, 0.95);
    box(1.0, 0.24, 0.85, "#c3d6d9", sofaX + 0.72, 0.82, sofaZ - 0.05, 0.95);

    // coffee table
    const tabX = 4.3;
    const tabZ = -2.3;
    box(1.5, 0.09, 0.9, "#8a5a33", tabX, 0.48, tabZ, 0.85);
    for (const [lx, lz] of [
      [-0.68, -0.38],
      [0.68, -0.38],
      [-0.68, 0.38],
      [0.68, 0.38],
    ] as const) {
      box(0.09, 0.48, 0.09, "#6e4526", tabX + lx, 0.24, tabZ + lz, 0.85);
    }

    // desk A + monitor + chair
    const deskA = (x: number, z: number, top: string, leg: string, mz: number) => {
      box(2.1, 0.09, 1.0, top, x, 0.86, z, 0.8);
      for (const [lx, lz] of [
        [-0.95, -0.42],
        [0.95, -0.42],
        [-0.95, 0.42],
        [0.95, 0.42],
      ] as const) {
        box(0.1, 0.86, 0.1, leg, x + lx, 0.43, z + lz, 0.85);
      }
      box(1.15, 0.02, 0.42, "#2a2a35", x + mz * 0.05, 0.93, z, 0.6);
      box(0.02, 0.62, 0.95, "#14141c", x + mz * 0.05, 1.32, z, 0.4);
      box(0.86, 0.55, 0.02, "#14141c", x + mz * 0.06, 1.3, z - 0.02, 0.4);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78, 0.46),
        new THREE.MeshBasicMaterial({ color: "#7fb5ff" })
      );
      screen.position.set(x + mz * 0.07, 1.3, z - 0.04);
      screen.rotation.y = Math.PI / 2;
      this.scene.add(screen);
    };
    deskA(-6.4, -2.4, "#7c5330", "#5d3c20", 1);
    box(0.5, 0.12, 0.5, "#3d3d4d", -4.4, 0.28, -2.2, 0.85);
    box(0.5, 0.7, 0.12, "#3d3d4d", -4.4, 0.6, -2.45, 0.85);
    box(0.12, 0.4, 0.5, "#3d3d4d", -4.6, 0.6, -2.2, 0.85);
    box(0.12, 0.4, 0.5, "#3d3d4d", -4.2, 0.6, -2.2, 0.85);
    deskA(7.4, 3.6, "#6e5a86", "#4c3d60", -1);
    box(0.5, 0.12, 0.5, "#3d3d4d", 5.4, 0.28, 3.8, 0.85);
    box(0.5, 0.7, 0.12, "#3d3d4d", 5.4, 0.6, 3.55, 0.85);
    box(0.12, 0.4, 0.5, "#3d3d4d", 5.2, 0.6, 3.8, 0.85);
    box(0.12, 0.4, 0.5, "#3d3d4d", 5.6, 0.6, 3.8, 0.85);

    // plants
    const mkPlant = (x: number, z: number, scale: number, pot: string) => {
      const g = new THREE.Group();
      const potMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.26, 0.5, 14),
        std(pot, 0.9)
      );
      potMesh.position.y = 0.25;
      potMesh.castShadow = true;
      g.add(potMesh);
      const foliageMat = std("#3e7d44", 0.9);
      const f1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), foliageMat);
      f1.position.y = 0.95;
      const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), foliageMat);
      f2.position.set(0.22, 1.15, 0.05);
      const f3 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), foliageMat);
      f3.position.set(-0.2, 1.2, -0.06);
      f1.castShadow = f2.castShadow = f3.castShadow = true;
      g.add(f1, f2, f3);
      g.position.set(x, 0, z);
      g.scale.setScalar(scale);
      this.scene.add(g);
    };
    mkPlant(10.6, -7.2, 1.15, "#b26a4a");
    mkPlant(-10.8, 6.6, 0.95, "#8a9a5a");

    // floor lamp
    const lampX = 2.6;
    const lampZ = 5.9;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 1.9, 10),
      std("#3a3a46", 0.6)
    );
    pole.position.set(lampX, 0.95, lampZ);
    pole.castShadow = true;
    this.scene.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 14), std("#3a3a46", 0.6));
    base.position.set(lampX, 0.03, lampZ);
    this.scene.add(base);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.18, 0.34, 14, 1, true),
      std("#e8d7b8", 0.9)
    );
    shade.position.set(lampX, 1.95, lampZ);
    shade.castShadow = true;
    this.scene.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshBasicMaterial({ color: "#ffd9a0" })
    );
    bulb.position.set(lampX, 1.82, lampZ);
    this.scene.add(bulb);
    const lampLight = new THREE.PointLight(0xffc98f, 20, 11, 2);
    lampLight.position.set(lampX, 1.85, lampZ);
    this.scene.add(lampLight);
  }

  // ── Post-processing (SSAO + bloom + AA, gated by device tier) ───────────────
  // Probes whether the GPU can actually render into half-float render targets.
  // Some stacks (e.g. ANGLE-on-Metal headless) advertise the extension but
  // silently produce black frames — in that case we degrade to 8-bit targets
  // and drop the passes that depend on float precision (SSAO, bloom).
  private detectHalfFloatRender(): boolean {
    try {
      const { WebGLRenderTarget, HalfFloatType, Color, Scene } = THREE;
      const probeRT = new WebGLRenderTarget(2, 2, { type: HalfFloatType });
      const probeScene = new Scene();
      probeScene.background = new Color(0x00ff00);
      this.renderer.setRenderTarget(probeRT);
      this.renderer.render(probeScene, this.camera);
      this.renderer.setRenderTarget(null);
      const px = new Float32Array(4);
      this.renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, px);
      probeRT.dispose();
      return px[1] > 0.5;
    } catch {
      return false;
    }
  }

  private async initPostProcessing() {
    if (this.quality === "low") return;
    try {
      const [{ EffectComposer }, { RenderPass }, { OutputPass }] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
      ]);
      if (this.disposed) return;
      const w = this.container.clientWidth || 1;
      const h = this.container.clientHeight || 1;
      const halfFloat = this.detectHalfFloatRender();

      const composer = new EffectComposer(
        this.renderer,
        new THREE.WebGLRenderTarget(w, h, {
          type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        })
      );
      composer.setPixelRatio(
        this.quality === "high" ? Math.min(window.devicePixelRatio || 1, 1.5) : 1.25
      );
      composer.addPass(new RenderPass(this.scene, this.camera));

      let ssao: SSAOPass | null = null;
      let bloom: UnrealBloomPass | null = null;

      if (this.quality === "high" && halfFloat) {
        const [{ SSAOPass }, { UnrealBloomPass }, { SMAAPass }] = await Promise.all([
          import("three/examples/jsm/postprocessing/SSAOPass.js"),
          import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
          import("three/examples/jsm/postprocessing/SMAAPass.js"),
        ]);
        if (this.disposed) return;
        ssao = new SSAOPass(this.scene, this.camera, w, h);
        ssao.kernelRadius = 0.5;
        ssao.minDistance = 0.003;
        ssao.maxDistance = 0.1;
        composer.addPass(ssao);

        bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.4, 0.68);
        composer.addPass(bloom);

        composer.addPass(new OutputPass());
        composer.addPass(new SMAAPass());
      } else {
        composer.addPass(new OutputPass());
      }

      this.post = { composer, ssao, bloom };
      this.resize();
    } catch {
      // post-processing is optional — fall back to the direct render path
      this.post = null;
    }
  }

  // ── Movement + collision (game-feel: acceleration, smoothing, head bob) ─────
  private updatePlayer(dt: number) {
    let f = 0;
    let r = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) f += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) f -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) r += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) r -= 1;
    // touch joystick overrides
    if (this.touchMoveX !== 0 || this.touchMoveZ !== 0) {
      r = this.touchMoveX;
      f = this.touchMoveZ;
    }
    const sprint = this.keys.has("shift") || this.touchSprint;
    const targetSpeed = sprint ? 5.4 : 3.1;

    // desired direction → smooth acceleration toward it
    const len = Math.hypot(f, r);
    let dX = 0;
    let dZ = 0;
    if (len > 0.01) {
      const nf = f / len;
      const nr = r / len;
      dX = -Math.sin(this.yaw) * nf + Math.cos(this.yaw) * nr;
      dZ = -Math.cos(this.yaw) * nf - Math.sin(this.yaw) * nr;
    }
    const accel = 1 - Math.exp(-dt * 11);
    this.velX += (dX * targetSpeed - this.velX) * accel;
    this.velZ += (dZ * targetSpeed - this.velZ) * accel;

    this.px += this.velX * dt;
    this.pz += this.velZ * dt;

    // walls
    const m = 0.45;
    const cx = Math.max(-HALF_W + m, Math.min(HALF_W - m, this.px));
    const cz = Math.max(-HALF_D + m, Math.min(HALF_D - m, this.pz));
    if (cx !== this.px) {
      this.px = cx;
      this.velX = 0;
    }
    if (cz !== this.pz) {
      this.pz = cz;
      this.velZ = 0;
    }
    // static furniture — slide along surfaces, kill velocity into them
    for (const c of this.colliders) {
      const dx = this.px - c.x;
      const dz = this.pz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.42;
      if (d < min && d > 0.0001) {
        const nx = dx / d;
        const nz = dz / d;
        this.px = c.x + nx * min;
        this.pz = c.z + nz * min;
        const into = this.velX * nx + this.velZ * nz;
        if (into < 0) {
          this.velX -= nx * into;
          this.velZ -= nz * into;
        }
      }
    }

    // smoothed look (targets accumulate from addLook)
    const lookK = 1 - Math.exp(-dt * 15);
    this.yaw += (this.lookYaw - this.yaw) * lookK;
    this.pitch += (this.lookPitch - this.pitch) * lookK;

    // subtle head bob + sprint FOV kick
    const speed = Math.hypot(this.velX, this.velZ);
    const moving = speed > 0.2;
    if (moving) this.bobPhase += dt * (7 + speed * 1.4);
    const bob = moving ? Math.sin(this.bobPhase) * 0.026 * Math.min(1, speed / targetSpeed) : 0;
    const targetFov = sprint && moving ? SPRINT_FOV : BASE_FOV;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 5));

    // ── third-person follow camera ──
    // desired orbit position sits behind the player on the movement heading
    const camX = this.px + Math.sin(this.yaw) * CAM_DIST;
    const camZ = this.pz + Math.cos(this.yaw) * CAM_DIST;
    const camK = 1 - Math.exp(-dt * 8);
    if (!this.camInit) {
      this.camPos.set(camX, CAM_HEIGHT, camZ);
      this.camInit = true;
    } else {
      this.camPos.x += (camX - this.camPos.x) * camK;
      this.camPos.z += (camZ - this.camPos.z) * camK;
      this.camPos.y += (CAM_HEIGHT - this.camPos.y) * camK;
    }
    // keep the camera inside the room
    const cxm = Math.max(-HALF_W + 0.4, Math.min(HALF_W - 0.4, this.camPos.x));
    if (cxm !== this.camPos.x) this.camPos.x = cxm;
    const czm = Math.max(-HALF_D + 0.4, Math.min(HALF_D - 0.4, this.camPos.z));
    if (czm !== this.camPos.z) this.camPos.z = czm;
    // push out of furniture colliders so the camera never clips through
    for (const c of this.colliders) {
      const dx = this.camPos.x - c.x;
      const dz = this.camPos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.35;
      if (d < min && d > 0.0001) {
        this.camPos.x = c.x + (dx / d) * min;
        this.camPos.z = c.z + (dz / d) * min;
      }
    }
    // vertical look: drag-pitch raises/lowers the framed point on the player
    const lookY = Math.max(0.35, Math.min(2.3, LOOK_Y - this.pitch * 1.4));
    this.camera.position.set(this.camPos.x, this.camPos.y + bob, this.camPos.z);
    this.camera.lookAt(this.px, lookY, this.pz);

    // player avatar body follows position/heading (remotes see your back)
    if (this.playerBody) {
      this.playerBody.position.set(this.px, moving ? Math.sin(this.bobPhase) * 0.015 : 0, this.pz);
      this.playerBody.rotation.set(0, this.yaw, 0);
    }

    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Reconcile the network-driven avatars with the current presence snapshot. */
  setRemoteUsers(users: RemoteUserState[]) {
    const seen = new Set<string>();
    for (const u of users) {
      seen.add(u.id);
      let r = this.remotes.get(u.id);
      if (!r) {
        r = buildRemoteAvatar(u.id, u.name);
        r.x = u.x;
        r.z = u.z;
        r.heading = u.heading;
        this.scene.add(r.group);
        this.remotes.set(u.id, r);
      }
      r.targetX = u.x;
      r.targetZ = u.z;
      r.targetHeading = u.heading;
      r.mic = u.mic;
      r.micBadge.visible = u.mic;
      if (r.name !== u.name) {
        r.name = u.name;
        (r.label.material as THREE.SpriteMaterial).map = makeLabelTexture(
          u.name,
          "In the studio",
          r.color
        );
        (r.label.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.group);
        this.remotes.delete(id);
      }
    }
  }

  private updateRemotes(dt: number, t: number) {
    for (const r of this.remotes.values()) {
      const k = Math.min(1, dt * 7);
      r.x += (r.targetX - r.x) * k;
      r.z += (r.targetZ - r.z) * k;
      let dh = r.targetHeading - r.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      r.heading += dh * Math.min(1, dt * 8);
      r.group.position.set(r.x, Math.sin(t * 2.1 + r.phase) * 0.02, r.z);
      r.group.rotation.y = r.heading;
    }
  }

  // ── Resource cleanup ─────────────────────────────────────────────────────────
  private disposeScene() {
    const seenMats = new Set<THREE.Material>();
    const seenTex = new Set<THREE.Texture>();
    const seenGeo = new Set<THREE.BufferGeometry>();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.geometry && !seenGeo.has(mesh.geometry)) {
          seenGeo.add(mesh.geometry);
          mesh.geometry.dispose();
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (!mat || seenMats.has(mat)) continue;
          seenMats.add(mat);
          for (const v of Object.values(mat)) {
            if (v instanceof THREE.Texture && !seenTex.has(v)) {
              seenTex.add(v);
              v.dispose();
            }
          }
          mat.dispose();
        }
      }
    });
    if (this.scene.environment) {
      this.scene.environment.dispose();
      this.scene.environment = null;
    }
  }
}