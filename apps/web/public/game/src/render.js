// Stylized-PBR renderer: real sunlight with soft shadows, sky, fog and ACES
// tone mapping — the lush-adventure look. Every material in the game flows
// through makeInkMaterial, which now returns a MeshStandardMaterial in a
// shared palette, so the whole world converts at once and no game logic or
// module interface changes. The old pen-on-paper post pass is gone; the hurt /
// flash / slow feedback it owned now lives in fixed DOM overlays.

import * as THREE from 'three';

export const INK = { BLUE: 0, RED: 1, BLACK: 2, ORANGE: 3, GREEN: 4, PINK: 5, GRASS: 6, TAN: 7 };

// Material roles for a bright stylized outdoors. 0-5 are the classic ink roles
// (ids are sent over the network for debris colors — never reorder); 6-7 are
// terrain colors the level builders use.
export const INK_COLORS = [
  new THREE.Color(0x2970fa), // BLUE   — friendly ink, weapons, structures
  new THREE.Color(0xe0242a), // RED    — enemies, danger, blood
  new THREE.Color(0x292b36), // BLACK  — metal, dark parts, markings
  new THREE.Color(0xff941a), // ORANGE — effects, highlights, flashes
  new THREE.Color(0x33c757), // GREEN  — health, pickups
  new THREE.Color(0xf575ad), // PINK   — eraser / boss
  new THREE.Color(0x52a345), // GRASS  — the ground
  new THREE.Color(0xd6ad70), // TAN    — sand, mesas
];

export const LIGHT_WORLD = new THREE.Vector3(0.38, 0.82, 0.42).normalize();
// kept for backward compatibility with anything that pokes at shader uniforms
export const shared = { uLightDir: { value: LIGHT_WORLD.clone() }, uTime: { value: 0 } };

/** Palette color for an ink id (clamped — safe for network-supplied ids). */
export const inkRGB = (id) => INK_COLORS[Math.max(0, Math.min(INK_COLORS.length - 1, Math.round(id)))];

export function makeInkMaterial(opts = {}) {
  const ink = opts.ink ?? INK.BLUE;
  const fill = opts.fill ?? false;
  const m = new THREE.MeshStandardMaterial({
    color: inkRGB(ink).clone(),
    side: opts.side ?? THREE.FrontSide,
    flatShading: true, // crisp low-poly facets catch the sun like a diorama
    roughness: fill ? 0.5 : 0.85,
    metalness: 0.0,
  });
  m.inkId = ink;
  m.fillInk = !!fill;
  return m;
}
export function setInk(mat, ink) { mat.inkId = ink; mat.color.copy(inkRGB(ink)); }
export function setFill(mat, fill) { mat.fillInk = !!fill; mat.roughness = fill ? 0.5 : 0.85; }

/** Enable sun casting/receiving on a subtree (level chunks, characters). */
export function shadows(o) {
  o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
}

export class InkRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7fc4ee);
    this.scene.fog = new THREE.Fog(0xa9d9f2, 55, 240);
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.08, 420);

    // sky fill + sun
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8c7b58, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1da, 2.4);
    sun.position.copy(LIGHT_WORLD).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75;
    sun.shadow.camera.bottom = -75;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this._makeClouds();
    this._makeOverlays();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // soft billboard clouds drifting high around the arena
  _makeClouds() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const blob = (x, y, r) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    blob(64, 74, 40);
    blob(40, 62, 26);
    blob(90, 62, 26);
    blob(64, 48, 24);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(mat);
      const a = (i / 10) * Math.PI * 2 + (i % 3) * 0.4;
      const r = 45 + ((i * 37) % 90);
      s.position.set(Math.cos(a) * r, 36 + ((i * 13) % 28), Math.sin(a) * r);
      const sc = 26 + ((i * 11) % 22);
      s.scale.set(sc * 1.7, sc, 1);
      this.scene.add(s);
    }
  }

  // full-screen feedback overlays (the old post-pass effects, reborn in CSS)
  _makeOverlays() {
    const mk = (bg) => {
      const el = document.createElement('div');
      el.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:${bg}`;
      const hud = document.getElementById('hud');
      if (hud) document.body.insertBefore(el, hud); else document.body.appendChild(el);
      return el;
    };
    this.hurtEl = mk('radial-gradient(ellipse at center, rgba(220,30,40,0) 42%, rgba(190,20,30,0.6) 100%)');
    this.flashEl = mk('rgba(255,255,255,0.9)');
    this.slowEl = mk('rgba(140,160,190,0.55)');
  }

  resize() {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(time, fx = {}) {
    shared.uTime.value = time;
    const pulse = fx.lowHp ? (0.35 + 0.25 * Math.sin(time * 6)) * fx.lowHp : 0;
    this.hurtEl.style.opacity = Math.min(1, (fx.hurt || 0) + pulse).toFixed(3);
    this.flashEl.style.opacity = Math.min(1, fx.flash || 0).toFixed(3);
    this.slowEl.style.opacity = ((fx.slow || 0) * 0.35).toFixed(3);
    this.renderer.render(this.scene, this.camera);
  }
}
