/**
 * Generates the stylized GLB furniture assets used by the Designer Room
 * (`apps/web/lib/designers/room.ts`).
 *
 * Run from `apps/web`:
 *   node scripts/generate-room-assets.mjs
 *
 * The generated binary GLBs are committed to `apps/web/public/designers/`
 * so the room can load them at runtime with GLTFLoader. Re-run this script
 * any time the furniture geometry/materials need tweaking.
 *
 * Everything is built from primitives with named PBR materials — no textures —
 * so assets stay small, consistent in style, and cheap to re-tint at runtime
 * (e.g. the purple desk on the right side of the room).
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Node-compat shim: three's GLTFExporter async path reads Blobs via FileReader,
// which only exists in browsers. Blob.arrayBuffer() gives us the same bytes.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      if (this.onloadend) this.onloadend();
    });
  }
};

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "designers");

const std = (name, color, rough = 0.8, metal = 0) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  m.name = name;
  return m;
};

const rbox = (w, h, d, r, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);

const mesh = (geo, mat, x, y, z, ry = 0, rx = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  return m;
};

// ─── Shared palette (kept in sync with the runtime look) ──────────────────────
const C = {
  wood: 0xa9713f,
  woodDark: 0x7a5230,
  metal: 0x2c2c38,
  metalDark: 0x23232b,
  fabric: 0x4a7c8a,
  fabricDark: 0x3f6b77,
  pillow: 0xd8e4e6,
  pillowAlt: 0xc3d6d9,
  plastic: 0x14141c,
  plasticGrey: 0x3d3d4d,
  shade: 0xe8d7b8,
  clay: 0xb26a4a,
  leaf: 0x3e7d44,
  leafDark: 0x356b3c,
  leafLight: 0x4c9152,
  soil: 0x33231a,
};

// ─── Sofa (faces +Z) ──────────────────────────────────────────────────────────
function sofa() {
  const g = new THREE.Group();
  const fabric = std("fabric", C.fabric, 0.95);
  const fabricDark = std("fabricDark", C.fabricDark, 0.95);
  const pillowM = std("pillow", C.pillow, 0.9);
  const pillowAltM = std("pillowAlt", C.pillowAlt, 0.9);
  const feetM = std("woodDark", C.woodDark, 0.6, 0.15);

  const base = mesh(rbox(2.96, 0.34, 1.1, 0.06), fabric, 0, 0.25, 0);
  const back = mesh(rbox(2.9, 0.74, 0.26, 0.1), fabricDark, 0, 0.93, -0.52);
  back.rotation.x = -0.06;
  const armL = mesh(rbox(0.3, 0.64, 1.06, 0.1), fabricDark, -1.33, 0.56, -0.02);
  const armR = mesh(rbox(0.3, 0.64, 1.06, 0.1), fabricDark, 1.33, 0.56, -0.02);

  const seatL = mesh(rbox(1.28, 0.2, 0.88, 0.09), fabric, -0.7, 0.52, -0.1);
  const seatR = mesh(rbox(1.28, 0.2, 0.88, 0.09), fabric, 0.7, 0.52, -0.1);

  const p1 = mesh(rbox(0.56, 0.3, 0.13, 0.07), pillowM, -0.62, 0.82, -0.38);
  p1.rotation.y = 0.35;
  const p2 = mesh(rbox(0.56, 0.3, 0.13, 0.07), pillowAltM, 0.72, 0.82, -0.4);
  p2.rotation.y = -0.3;

  const legGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.06, 8);
  for (const [lx, lz] of [[-1.36, 0.48], [1.36, 0.48], [-1.36, -0.48], [1.36, -0.48]]) {
    g.add(mesh(legGeo, feetM, lx, 0.03, lz));
  }

  g.add(base, back, armL, armR, seatL, seatR, p1, p2);
  return g;
}

// ─── Coffee table ─────────────────────────────────────────────────────────────
function coffeeTable() {
  const g = new THREE.Group();
  const wood = std("wood", C.wood, 0.75);
  const woodDark = std("woodDark", C.woodDark, 0.8);
  const metal = std("metal", C.metal, 0.4, 0.85);

  const top = mesh(rbox(1.5, 0.06, 0.9, 0.03), wood, 0, 0.52, 0);
  const shelf = mesh(rbox(1.1, 0.04, 0.6, 0.02), woodDark, 0, 0.13, 0);
  const legGeo = rbox(0.06, 0.48, 0.06, 0.015);
  for (const [lx, lz] of [[-0.68, -0.38], [0.68, -0.38], [-0.68, 0.38], [0.68, 0.38]]) {
    g.add(mesh(legGeo, metal, lx, 0.26, lz));
  }

  // two stacked books for decoration
  const bookA = mesh(rbox(0.26, 0.035, 0.2, 0.008), std("bookA", 0x2f4a6b, 0.85), 0.16, 0.562, 0.16);
  const bookB = mesh(rbox(0.24, 0.03, 0.18, 0.008), std("bookB", 0xd95d39, 0.85), 0.15, 0.6, 0.15);

  g.add(top, shelf, bookA, bookB);
  return g;
}

// ─── Desk (top + left pedestal with drawers + right metal legs) ───────────────
function desk() {
  const g = new THREE.Group();
  const wood = std("wood", C.wood, 0.7);
  const woodDark = std("woodDark", C.woodDark, 0.8);
  const metal = std("metal", C.metal, 0.4, 0.85);
  const drawerF = std("drawer", 0x8f6a44, 0.8);
  const deskMat = std("deskMat", 0x23232e, 0.85);
  const keyMat = std("keyboard", 0x101016, 0.6);

  const top = mesh(rbox(2.1, 0.07, 1.0, 0.025), wood, 0, 0.905, 0);

  // pedestal (drawer unit) on the left
  const ped = mesh(rbox(0.62, 0.8, 0.94, 0.03), woodDark, -0.74, 0.44, 0);
  const d1 = mesh(rbox(0.52, 0.22, 0.02, 0.008), drawerF, -0.74, 0.6, 0.47);
  const d2 = mesh(rbox(0.52, 0.22, 0.02, 0.008), drawerF, -0.74, 0.35, 0.47);
  const hGeo = rbox(0.16, 0.018, 0.018, 0.006);
  const h1 = mesh(hGeo, metal, -0.74, 0.6, 0.485);
  const h2 = mesh(hGeo, metal, -0.74, 0.35, 0.485);

  // metal legs on the right side
  const legGeo = rbox(0.07, 0.86, 0.07, 0.015);
  for (const lz of [-0.42, 0.42]) g.add(mesh(legGeo, metal, 0.74, 0.44, lz));

  // desk mat + keyboard + mouse
  const mat = mesh(rbox(0.55, 0.008, 0.32, 0.004), deskMat, 0.05, 0.945, -0.02);
  const kb = mesh(rbox(0.4, 0.024, 0.15, 0.008), keyMat, 0.1, 0.955, 0.18);
  const kbRaise = mesh(rbox(0.4, 0.02, 0.06, 0.006), keyMat, 0.1, 0.977, 0.26);
  const mouse = mesh(rbox(0.055, 0.028, 0.09, 0.014), keyMat, 0.42, 0.952, 0.22);

  g.add(top, ped, d1, d2, h1, h2, mat, kb, kbRaise, mouse);
  return g;
}

// ─── Monitor (faces +Z; "Screen" mesh is tinted at runtime) ───────────────────
function monitor() {
  const g = new THREE.Group();
  const plastic = std("plastic", C.plastic, 0.55);
  const metal = std("metal", C.metal, 0.4, 0.85);

  const base = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.02, 14), metal, 0, 0.01, 0);
  const stem = mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.24, 10), plastic, 0, 0.14, 0);
  const panel = mesh(rbox(0.86, 0.55, 0.035, 0.01), plastic, 0, 0.48, 0.03);
  const screen = mesh(rbox(0.78, 0.46, 0.008, 0.004), std("Screen", 0x05070c, 0.3), 0, 0.48, 0.052);
  const cam = mesh(new THREE.SphereGeometry(0.012, 6, 6), std("cam", 0x0a0a0f, 0.5), 0, 0.73, 0.049);

  g.add(base, stem, panel, screen, cam);
  return g;
}

// ─── Task chair (faces +Z, backrest at -Z) ────────────────────────────────────
function chair() {
  const g = new THREE.Group();
  const plastic = std("plasticGrey", C.plasticGrey, 0.85);
  const seatM = std("seat", 0x2f2f3a, 0.9);
  const metal = std("metal", C.metal, 0.35, 0.8);

  // 5-star base
  const hub = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 10), metal, 0, 0.025, 0);
  const armGeo = rbox(0.032, 0.026, 0.24, 0.012);
  const casterGeo = new THREE.SphereGeometry(0.028, 8, 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = mesh(armGeo, metal, Math.sin(a) * 0.11, 0.026, Math.cos(a) * 0.11, -a);
    g.add(arm);
    g.add(mesh(casterGeo, std("caster", 0x101016, 0.4), Math.sin(a) * 0.2, 0.012, Math.cos(a) * 0.2));
  }
  const pole = mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.36, 8), metal, 0, 0.23, 0);
  const seat = mesh(rbox(0.5, 0.07, 0.5, 0.04), seatM, 0, 0.46, -0.02);
  const back = mesh(rbox(0.44, 0.52, 0.06, 0.03), seatM, 0, 0.85, -0.34);
  back.rotation.x = -0.12;
  const armL = mesh(rbox(0.045, 0.06, 0.3, 0.018), seatM, -0.31, 0.62, -0.1);
  const armR = mesh(rbox(0.045, 0.06, 0.3, 0.018), seatM, 0.31, 0.62, -0.1);

  g.add(hub, pole, seat, back, armL, armR);
  return g;
}

// ─── Floor lamp ───────────────────────────────────────────────────────────────
function floorLamp() {
  const g = new THREE.Group();
  const metal = std("metal", C.metal, 0.4, 0.85);
  const shade = std("shade", C.shade, 0.9);
  const bulb = std("Bulb", 0xfff1d6, 0.4);
  bulb.emissive = new THREE.Color(0xffe2ae);
  bulb.emissiveIntensity = 1.6;

  const base = mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.045, 14), metal, 0, 0.0225, 0);
  const pole = mesh(new THREE.CylinderGeometry(0.028, 0.032, 1.7, 10), metal, 0, 0.92, 0);
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), metal, 0, 1.2, 0);
  ring.rotation.x = Math.PI / 2;
  const shadeMesh = mesh(
    new THREE.CylinderGeometry(0.3, 0.17, 0.36, 16, 1, true),
    shade,
    0,
    1.97,
    0
  );
  const shadeInner = mesh(
    new THREE.CylinderGeometry(0.295, 0.165, 0.37, 16, 1, true),
    std("shadeInner", 0xcbb78f, 1),
    0,
    1.97,
    0
  );
  shadeInner.rotation.x = Math.PI;
  const bulbM = mesh(new THREE.SphereGeometry(0.085, 10, 8), bulb, 0, 1.88, 0);

  g.add(base, pole, ring, shadeMesh, shadeInner, bulbM);
  return g;
}

// ─── Plant (stylized leaves + clay pot) ───────────────────────────────────────
function plant() {
  const g = new THREE.Group();
  const clay = std("clay", C.clay, 0.85);
  const soil = std("soil", C.soil, 1);
  const leafM = std("leaf", C.leaf, 0.9);
  const leafDarkM = std("leafDark", C.leafDark, 0.9);
  const leafLightM = std("leafLight", C.leafLight, 0.9);

  const pot = mesh(new THREE.CylinderGeometry(0.32, 0.24, 0.4, 14), clay, 0, 0.2, 0);
  const rim = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 14), clay, 0, 0.41, 0);
  const dirt = mesh(new THREE.CylinderGeometry(0.29, 0.27, 0.03, 14), soil, 0, 0.425, 0);

  // a few stems, then fanning leaves
  const stemGeo = new THREE.CylinderGeometry(0.018, 0.026, 0.28, 6);
  const leafGeo = new THREE.SphereGeometry(0.3, 10, 8);
  leafGeo.scale(1, 2.3, 0.26);

  const stem = mesh(stemGeo, std("stem", 0x2c5a31, 0.9), 0, 0.56, 0);
  g.add(stem);

  const leaves = [
    { x: 0, y: 0.78, z: 0, ry: 0, rz: 0.18, m: leafM, s: 1.0 },
    { x: 0, y: 0.9, z: 0, ry: 2.4, rz: 0.3, m: leafDarkM, s: 0.9 },
    { x: 0, y: 0.86, z: 0, ry: -2.4, rz: -0.28, m: leafLightM, s: 0.85 },
    { x: 0, y: 0.8, z: 0, ry: 0.9, rz: -0.42, m: leafDarkM, s: 0.95 },
    { x: 0, y: 0.84, z: 0, ry: -1.1, rz: 0.4, m: leafM, s: 0.9 },
    { x: 0, y: 0.72, z: 0, ry: 3.3, rz: 0.5, m: leafLightM, s: 0.8 },
    { x: 0, y: 0.7, z: 0, ry: -3.2, rz: -0.5, m: leafM, s: 0.82 },
  ];
  for (const l of leaves) {
    const leaf = mesh(leafGeo, l.m, l.x, l.y, l.z, l.ry);
    leaf.rotation.z = l.rz;
    leaf.scale.setScalar(l.s);
    g.add(leaf);
  }

  const clumpGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const clump = mesh(clumpGeo, leafDarkM, 0, 0.66, 0);
  g.add(pot, rim, dirt, clump);
  return g;
}

// ─── Export ───────────────────────────────────────────────────────────────────
// A fresh exporter per asset: GLTFExporter keeps internal state (buffers,
// pending promises, caches) across exports, so reusing one instance corrupts
// the output of every asset after the first.
async function exportAsset(name, build) {
  const group = build();
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(group, { binary: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${name}.glb`);
  writeFileSync(out, Buffer.from(glb));
  console.log(`wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
}

const ASSETS = [
  ["sofa", sofa],
  ["coffee-table", coffeeTable],
  ["desk", desk],
  ["monitor", monitor],
  ["chair", chair],
  ["floor-lamp", floorLamp],
  ["plant", plant],
];

for (const [name, build] of ASSETS) await exportAsset(name, build);
console.log("done.");
