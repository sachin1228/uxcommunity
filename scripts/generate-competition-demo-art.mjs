/**
 * Generates the demo artwork used by the opt-in competition seed
 * (`supabase/seeds/competitions-demo.sql`).
 *
 * Why a generator instead of committed screenshots: the seed needs real,
 * self-hosted images (no hotlinking, works offline, no storage credentials),
 * and twelve hand-written mockups would be twelve files to review. This emits
 * deterministic SVG "design submissions" — a phone screen per entry, in
 * palettes and layouts that look like real product work — so the gallery reads
 * as a gallery rather than a wall of placeholders.
 *
 * Output: apps/web/public/competition-demo/demo-01.svg … demo-12.svg
 *
 * Run: node scripts/generate-competition-demo-art.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "apps", "web", "public", "competition-demo");

const W = 900;
const H = 1600;

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Palettes: dark editorial, soft neutral, cool, warm, deep. */
const PALETTES = [
  { bg: "#0b1220", surface: "#141d2e", ink: "#f4f7fb", muted: "#8ea0bb", accent: "#5b8def" },
  { bg: "#f6f4ef", surface: "#ffffff", ink: "#191713", muted: "#8b857a", accent: "#1f6f5c" },
  { bg: "#0e1b17", surface: "#16261f", ink: "#eef6f1", muted: "#8fb3a5", accent: "#4ade80" },
  { bg: "#1a1120", surface: "#261a31", ink: "#f6effa", muted: "#b39bc8", accent: "#c084fc" },
  { bg: "#fdf6ec", surface: "#ffffff", ink: "#2a1f14", muted: "#a08c76", accent: "#e07a2f" },
  { bg: "#0d1418", surface: "#16212a", ink: "#eff6f9", muted: "#87a3b3", accent: "#38bdf8" },
  { bg: "#f4f6fb", surface: "#ffffff", ink: "#141a26", muted: "#828da3", accent: "#6366f1" },
  { bg: "#12080a", surface: "#241114", ink: "#fbeef0", muted: "#c09198", accent: "#fb7185" },
];

const WORDS = [
  ["Partly", "cloudy", "18°"],
  ["Clarity", "by default", "24°"],
  ["Now", "playing", "03:42"],
  ["Your", "month", "₹42k"],
  ["Weekend", "in Udaipur", "3 days"],
  ["First", "ninety", "seconds"],
  ["Gusty", "evening", "12°"],
  ["Am I", "okay?", "Yes"],
  ["Discovery", "queue", "128"],
  ["Saved", "by default", "6 trips"],
  ["Setup", "in 40s", "3 steps"],
  ["Tomorrow", "bring a coat", "9°"],
];

const statusBar = (p) => `
  <g opacity="0.75">
    <text x="64" y="76" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" fill="${p.ink}">9:41</text>
    <rect x="742" y="54" width="46" height="22" rx="6" fill="none" stroke="${p.muted}" stroke-width="4"/>
    <rect x="752" y="63" width="20" height="5" rx="2.5" fill="${p.muted}"/>
    <rect x="800" y="58" width="4" height="14" rx="2" fill="${p.muted}"/>
    <rect x="812" y="52" width="4" height="20" rx="2" fill="${p.muted}"/>
    <rect x="824" y="46" width="4" height="26" rx="2" fill="${p.muted}"/>
  </g>`;

/** Layout archetypes — each returns the content block for a 900×1600 screen. */
const LAYOUTS = [
  // 0 — hero numeral
  (p, [a, b, c]) => `
    <text x="64" y="230" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" letter-spacing="6" fill="${p.muted}">FORECAST</text>
    <text x="64" y="340" font-family="Inter, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="${p.ink}">${escape(a)}</text>
    <text x="64" y="440" font-family="Inter, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="${p.ink}">${escape(b)}</text>
    <text x="64" y="600" font-family="Inter, Helvetica, Arial, sans-serif" font-size="220" font-weight="700" fill="${p.accent}">${escape(c)}</text>
    <rect x="64" y="700" width="772" height="1" fill="${p.muted}" opacity="0.35"/>
    ${[0, 1, 2, 3, 4]
      .map(
        (i) => `
      <g transform="translate(${64 + i * 158}, 790)">
        <text x="0" y="0" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" fill="${p.muted}">${["M", "T", "W", "T", "F"][i]}</text>
        <circle cx="34" cy="90" r="${34 + i * 5}" fill="${p.accent}" opacity="${0.18 + i * 0.14}"/>
        <text x="6" y="200" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.ink}">${12 + i}°</text>
      </g>`,
      )
      .join("")}
    <rect x="64" y="1090" width="772" height="300" rx="32" fill="${p.surface}"/>
    <text x="108" y="1170" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.muted}">REMINDER</text>
    <text x="108" y="1240" font-family="Inter, Helvetica, Arial, sans-serif" font-size="44" font-weight="600" fill="${p.ink}">${escape(b)} ${escape(c)}</text>
    <text x="108" y="1300" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.muted}">Umbrella stays home today.</text>`,

  // 1 — decision card
  (p, [a, b, c]) => `
    <text x="64" y="210" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" letter-spacing="5" fill="${p.muted}">TODAY</text>
    <text x="64" y="300" font-family="Inter, Helvetica, Arial, sans-serif" font-size="72" font-weight="700" fill="${p.ink}">${escape(a)}</text>
    <rect x="64" y="360" width="772" height="440" rx="36" fill="${p.surface}"/>
    <circle cx="200" cy="530" r="86" fill="${p.accent}" opacity="0.9"/>
    <text x="200" y="556" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="${p.bg}">${escape(c)}</text>
    <text x="330" y="490" font-family="Inter, Helvetica, Arial, sans-serif" font-size="34" fill="${p.ink}">${escape(b)}</text>
    <text x="330" y="546" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.muted}">Light jacket · 6 min walk</text>
    <text x="330" y="600" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.muted}">Leave by 8:20 to stay dry</text>
    ${[0, 1, 2]
      .map(
        (i) => `
      <rect x="64" y="${860 + i * 150}" width="772" height="120" rx="28" fill="${p.surface}" opacity="${1 - i * 0.18}"/>
      <rect x="104" y="${900 + i * 150}" width="60" height="60" rx="18" fill="${p.accent}" opacity="0.5"/>
      <text x="196" y="${930 + i * 150}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" fill="${p.ink}">${["Feels like 16°", "Wind 14 km/h", "Sunset 18:52"][i]}</text>
      <text x="196" y="${968 + i * 150}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" fill="${p.muted}">${["Dry through the evening", "Cooler than yesterday", "Good light for a walk"][i]}</text>`,
      )
      .join("")}`,

  // 2 — list / player
  (p, [a, b, c]) => `
    <rect x="64" y="150" width="772" height="520" rx="40" fill="${p.surface}"/>
    <rect x="104" y="190" width="692" height="440" rx="28" fill="${p.accent}" opacity="0.22"/>
    <text x="140" y="300" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" letter-spacing="5" fill="${p.muted}">${escape(a).toUpperCase()}</text>
    <text x="140" y="400" font-family="Inter, Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="${p.ink}">${escape(b)}</text>
    <text x="140" y="470" font-family="Inter, Helvetica, Arial, sans-serif" font-size="34" fill="${p.muted}">${escape(c)}</text>
    <rect x="140" y="530" width="620" height="8" rx="4" fill="${p.bg}" opacity="0.5"/>
    <rect x="140" y="530" width="240" height="8" rx="4" fill="${p.accent}"/>
    ${[0, 1, 2, 3, 4]
      .map(
        (i) => `
      <g transform="translate(64, ${740 + i * 140})">
        <rect x="0" y="0" width="772" height="112" rx="26" fill="${p.surface}" opacity="${1 - i * 0.13}"/>
        <rect x="36" y="26" width="60" height="60" rx="18" fill="${p.accent}" opacity="${0.7 - i * 0.1}"/>
        <text x="128" y="66" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" fill="${p.ink}">${escape(["Track", "Track", "Track", "Track", "Track"][i])} ${i + 1}</text>
        <text x="128" y="98" font-family="Inter, Helvetica, Arial, sans-serif" font-size="24" fill="${p.muted}">Because you played something softer</text>
      </g>`,
      )
      .join("")}`,

  // 3 — chart / overview
  (p, [a, b, c]) => `
    <text x="64" y="215" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" letter-spacing="5" fill="${p.muted}">OVERVIEW</text>
    <text x="64" y="320" font-family="Inter, Helvetica, Arial, sans-serif" font-size="120" font-weight="700" fill="${p.ink}">${escape(c)}</text>
    <text x="64" y="390" font-family="Inter, Helvetica, Arial, sans-serif" font-size="34" fill="${p.muted}">${escape(a)} ${escape(b)} · on track</text>
    <rect x="64" y="450" width="772" height="420" rx="36" fill="${p.surface}"/>
    ${Array.from({ length: 12 })
      .map((_, i) => {
        const barH = 60 + ((i * 67) % 220);
        return `<rect x="${116 + i * 60}" y="${790 - barH}" width="34" height="${barH}" rx="17" fill="${i === 8 ? p.accent : p.muted}" opacity="${i === 8 ? 1 : 0.35}"/>`;
      })
      .join("")}
    <rect x="64" y="920" width="772" height="220" rx="36" fill="${p.surface}"/>
    <text x="108" y="1000" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" fill="${p.muted}">BIGGEST CHANGE</text>
    <text x="108" y="1070" font-family="Inter, Helvetica, Arial, sans-serif" font-size="46" font-weight="600" fill="${p.ink}">Nothing unexpected</text>
    <text x="108" y="1116" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" fill="${p.muted}">Two subscriptions renew next week</text>`,

  // 4 — onboarding steps
  (p, [a, b, c]) => `
    <rect x="64" y="140" width="772" height="640" rx="40" fill="${p.surface}"/>
    <text x="120" y="260" font-family="Inter, Helvetica, Arial, sans-serif" font-size="28" letter-spacing="5" fill="${p.muted}">STEP 1 OF 3</text>
    <text x="120" y="370" font-family="Inter, Helvetica, Arial, sans-serif" font-size="82" font-weight="700" fill="${p.ink}">${escape(a)}</text>
    <text x="120" y="450" font-family="Inter, Helvetica, Arial, sans-serif" font-size="82" font-weight="700" fill="${p.ink}">${escape(b)}</text>
    <text x="120" y="540" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" fill="${p.muted}">No settings, no tour. One question</text>
    <text x="120" y="586" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" fill="${p.muted}">that changes what you see next.</text>
    <rect x="120" y="650" width="200" height="70" rx="35" fill="${p.accent}"/>
    <text x="220" y="696" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="30" font-weight="600" fill="${p.bg}">${escape(c)}</text>
    ${[0, 1, 2]
      .map(
        (i) => `
      <g transform="translate(64, ${840 + i * 160})">
        <circle cx="40" cy="46" r="26" fill="${p.accent}" opacity="${0.28 + i * 0.2}"/>
        <text x="40" y="56" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="${p.ink}">${i + 1}</text>
        <text x="100" y="40" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" fill="${p.ink}">${["Answer one question", "See a real result", "Keep what you like"][i]}</text>
        <text x="100" y="82" font-family="Inter, Helvetica, Arial, sans-serif" font-size="26" fill="${p.muted}">${["About 10 seconds", "Not a demo screen", "Everything is editable"][i]}</text>
      </g>`,
      )
      .join("")}`,
];

function render(index, palette, layout) {
  const p = palette;
  const [a, b, c] = WORDS[index % WORDS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Demo design submission">
  <rect width="${W}" height="${H}" fill="${p.bg}"/>
  ${statusBar(p)}
  ${LAYOUTS[layout](p, [a, b, c])}
</svg>
`;
}

mkdirSync(OUT_DIR, { recursive: true });

const COUNT = 12;
for (let i = 0; i < COUNT; i += 1) {
  const palette = PALETTES[i % PALETTES.length];
  const layout = i % LAYOUTS.length;
  const name = `demo-${String(i + 1).padStart(2, "0")}.svg`;
  writeFileSync(join(OUT_DIR, name), render(i, palette, layout), "utf8");
}

console.log(`Wrote ${COUNT} demo images to ${OUT_DIR}`);
