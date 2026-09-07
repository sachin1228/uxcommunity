// Model bridge — real Blender-made GLB models that keep the hand-drawn look.
//
// The renderer's post pass (outlines, hatching, paper grain) is applied to every
// mesh in the scene regardless of where its geometry came from. So models built
// in Blender and exported as GLB get the doodle treatment automatically once we
// swap their PBR materials for the game's ink shaders. That is what this module
// does: a small registry of models, a tolerant GLB loader with a cache, and a
// material bridge that maps each GLB part to an ink colour.
//
// Physics and collisions stay on the existing procedural bodies — models are
// visual only, which keeps gameplay unchanged while art swaps in.
//
// PHASE B: fill the registry with Blender exports, e.g.
//   registerModel('weapon.rifle', { path: 'models/weapon_rifle.glb', scale: 1 });
//
// Naming convention for parts inside Blender (matched on mesh/material names):
//   colour keywords: blue, red, black (or graphite/ink), orange, green, pink (or eraser)
//   "fill" or "solid"   -> solid scribble fill instead of hatching
//   "double"            -> material is two-sided
// If a part has no keyword, the GLB material's base colour is snapped to the
// nearest ink colour. Defaults to blue when nothing matches.
//
// Skinned/animated models are NOT supported by the ink shader yet — keep exports
// as static meshes until the shader grows a skinned variant.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { INK, INK_COLORS, makeInkMaterial } from './render.js';

const loader = new GLTFLoader();
const cache = new Map(); // key -> Promise<THREE.Group|null>

/** Entity -> model config. `path` is relative to the game root (/game/...). */
export const MODELS = {};

/**
 * Register a model so it can be preloaded and mounted by key.
 * @param {string} key       unique id, e.g. 'weapon.rifle'
 * @param {{path?: string, scale?: number, ink?: number, rev?: number|string}} cfg
 *   path: model file (omitted until the file exists -> silently skipped)
 *   scale: uniform scale applied on mount, defaults to 1
 *   ink:   default ink colour when part names carry no colour keyword
 *   rev:   optional cache-busting revision appended as ?v=
 */
export function registerModel(key, cfg) {
  MODELS[key] = { scale: 1, ...cfg };
}

const COLOR_WORDS = [
  { words: ['blue'], ink: INK.BLUE },
  { words: ['red'], ink: INK.RED },
  { words: ['black', 'graphite', 'ink'], ink: INK.BLACK },
  { words: ['orange'], ink: INK.ORANGE },
  { words: ['green'], ink: INK.GREEN },
  { words: ['pink', 'eraser'], ink: INK.PINK },
];

function inkForName(name) {
  const n = String(name || '').toLowerCase();
  for (const { words, ink } of COLOR_WORDS) if (words.some((w) => n.includes(w))) return ink;
  return null;
}

// snap an arbitrary GLB base colour to the closest of the six ink colours
function nearestInk(r, g, b) {
  let best = INK.BLUE, bestD = Infinity;
  for (const ink of [INK.BLUE, INK.RED, INK.BLACK, INK.ORANGE, INK.GREEN, INK.PINK]) {
    const c = INK_COLORS[ink];
    const d = (c.x - r) ** 2 + (c.y - g) ** 2 + (c.z - b) ** 2;
    if (d < bestD) { bestD = d; best = ink; }
  }
  return best;
}

/**
 * Replace every mesh's PBR material with an ink shader material so the doodle
 * post pass draws it like the procedural geometry. Mutates the given object.
 * @param {THREE.Object3D} root
 * @param {{ink?: number, fill?: boolean, shadeScale?: number, shadeBias?: number}} opts
 */
export function applyInkMaterials(root, opts = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    const ink = inkForName(obj.name) ?? inkForName(m.name) ?? (m.color ? nearestInk(m.color.r, m.color.g, m.color.b) : null) ?? opts.ink ?? INK.BLUE;
    const name = String(obj.name + ' ' + (m.name || '')).toLowerCase();
    const fill = opts.fill ?? /fill|solid/.test(name);
    const double = /double/.test(name);
    const old = obj.material;
    obj.material = makeInkMaterial({
      ink,
      fill,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
      shadeScale: opts.shadeScale ?? 1,
      shadeBias: opts.shadeBias ?? 0,
    });
    // keep one shared material per unique source material (GLTF gives each mesh its own)
    old.dispose?.();
  });
  return root;
}

function urlFor(key, cfg) {
  const p = cfg.path;
  if (!p) return null;
  const base = /^https?:\/\//.test(p) ? p : '/game/' + p.replace(/^\/+/, '');
  return cfg.rev != null ? `${base}?v=${cfg.rev}` : base;
}

/**
 * Load and cache a registered model (missing files resolve to null so the game
 * never breaks while a model is still being made in Blender).
 * @returns {Promise<THREE.Group|null>}
 */
export function loadModel(key) {
  if (cache.has(key)) return cache.get(key);
  const cfg = MODELS[key];
  if (!cfg) return Promise.resolve(null);
  const url = urlFor(key, cfg);
  const p = url
    ? loader.loadAsync(url).then(
        (gltf) => applyInkMaterials(gltf.scene, cfg),
        () => { console.warn(`[models] could not load "${key}" from ${url} — keeping the procedural mesh`); return null; }
      )
    : Promise.resolve(null);
  cache.set(key, p);
  return p;
}

/** Kick off loading for every registered model; never rejects, never blocks. */
export function preloadModels() {
  return Promise.allSettled(Object.keys(MODELS).map((key) => loadModel(key)));
}

/** Cached model for mounting (read-only — prefer cloneModel for placement). */
export async function getModel(key) {
  const m = await loadModel(key);
  return m || null;
}

/** A fresh instance of the model, ink materials already applied, or null. */
export async function cloneModel(key) {
  const m = await loadModel(key);
  if (!m) return null;
  const cfg = MODELS[key] || {};
  const clone = m.clone(true);
  if (cfg.scale && cfg.scale !== 1) clone.scale.setScalar(cfg.scale);
  return clone;
}

/**
 * Convenience for Phase C: mount a model under `parent`, removing any existing
 * children of `parent` first (used to swap a procedural weapon/enemy mesh).
 * Returns the mounted group or null when no model is registered/loaded.
 */
export async function mountModel(parent, key) {
  const model = await cloneModel(key);
  if (!model) return null;
  for (const child of [...parent.children]) {
    parent.remove(child);
    child.traverse?.((o) => { if (o.isMesh) o.geometry?.dispose(); });
  }
  parent.add(model);
  return model;
}