/**
 * 3D designer-studio room engine (plain three.js — WebGL2 + effect post).
 *
 * The room is a small stylized game environment built from KayKit "Furniture
 * Bits" CC0 assets (https://kaylousberg.com). Everything — furniture, material
 * pipeline, environment/IBL, shadows, AO and the follow camera — lives in this
 * module. React (`DesignersRoom.tsx`) is only responsible for the HUD, voice
 * (WebRTC) and input plumbing; all three.js state stays here.
 *
 * Rendering pipeline (WebGL2, chosen over WebGPU for production reliability on
 * the Next.js/OpenNext/Cloudflare stack):
 *   EffectComposer → RenderPass → UnrealBloomPass → OutputPass
 *   with ACES filmic tone mapping, sRGB output, a PMREM-based warm studio
 *   environment and a single strong directional "sun" coming through the
 *   window with soft PCF shadows.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// ─── Room constants ───────────────────────────────────────────────────────────
const HALF_W = 12; // room half-width  (x: ±12)
const HALF_D = 9; // room half-depth   (z: ±9)
const WALL_H = 4.6;
const EYE = 1.62; // player eye height

// KayKit assets live in apps/web/public/designers/kaykit (copied from the
// KayKit_Furniture_Bits_1.0_FREE pack so Next.js can serve them statically).
const KAYKIT_BASE = "/designers/kaykit";

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

// ─── Canvas / texture helpers ──────────────────────────────────────────────────

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Deterministic PRNG so the floor texture is stable across sessions. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Warm stylized wood floor: albedo + normal + roughness in one pass. */
function makeWoodMaps() {
  const SIZE = 1024;
  const PLANKS = 6;
  const plW = SIZE / PLANKS;
  const rng = mulberry32(0x5eed);

  const albedo = makeCanvas(SIZE, SIZE);
  const aCtx = albedo.getContext("2d")!;
  const height = makeCanvas(SIZE, SIZE);
  const hCtx = height.getContext("2d")!;

  aCtx.clearRect(0, 0, SIZE, SIZE);
  aCtx.fillStyle = "#d9a468";
  aCtx.fillRect(0, 0, SIZE, SIZE);
  hCtx.clearRect(0, 0, SIZE, SIZE);
  hCtx.fillStyle = "#7d7d7d";
  hCtx.fillRect(0, 0, SIZE, SIZE);

  // per-plank tone + grain
  for (let i = 0; i < PLANKS; i++) {
    const x0 = i * plW;
    const hue = 34 + (rng() * 8 - 4);
    const sat = 40 + rng() * 14;
    const light = 56 + rng() * 9;
    aCtx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    aCtx.fillRect(x0 + 1, 0, plW - 2, SIZE);
    hCtx.fillStyle = "#7f7f7f";
    hCtx.fillRect(x0 + 1, 0, plW - 2, SIZE);
    for (let s = 0; s < 26; s++) {
      const gx = x0 + rng() * plW;
      const gy = rng() * SIZE;
      const gl = 14 + rng() * 26;
      aCtx.strokeStyle = rng() > 0.5 ? "rgba(120,74,34,0.12)" : "rgba(255,235,200,0.10)";
      aCtx.lineWidth = 1;
      aCtx.beginPath();
      aCtx.moveTo(gx, gy);
      aCtx.bezierCurveTo(gx + 6, gy + gl * 0.3, gx - 6, gy + gl * 0.7, gx + 4, gy + gl);
      aCtx.stroke();
      hCtx.strokeStyle = rng() > 0.5 ? "rgba(70,70,70,0.5)" : "rgba(140,140,140,0.5)";
      hCtx.lineWidth = 1;
      hCtx.beginPath();
      hCtx.moveTo(gx, gy);
      hCtx.bezierCurveTo(gx + 6, gy + gl * 0.3, gx - 6, gy + gl * 0.7, gx + 4, gy + gl);
      hCtx.stroke();
    }
  }
  // soft seams (no hard black grid)
  for (let i = 1; i < PLANKS; i++) {
    aCtx.fillStyle = "rgba(96,60,26,0.32)";
    aCtx.fillRect(i * plW - 1, 0, 2, SIZE);
    hCtx.fillStyle = "#5a5a5a";
    hCtx.fillRect(i * plW - 1, 0, 2, SIZE);
  }
  // staggered horizontal joints
  for (let i = 1; i < 6; i++) {
    for (let row = 0; row < 4; row++) {
      const off = row % 2 === 0 ? 0 : plW / 2;
      const jy = row * (SIZE / 4);
      aCtx.fillStyle = "rgba(96,60,26,0.22)";
      aCtx.fillRect(((i * plW + off) % SIZE) - 1, jy, 2, 2);
      hCtx.fillStyle = "#6a6a6a";
      hCtx.fillRect(((i * plW + off) % SIZE) - 1, jy, 2, 2);
    }
  }
  // subtle ambient noise on both
  for (let n = 0; n < 2600; n++) {
    const nx = rng() * SIZE;
    const ny = rng() * SIZE;
    aCtx.fillStyle = `rgba(80,50,22,${0.02 + rng() * 0.05})`;
    aCtx.fillRect(nx, ny, 2, 2);
    hCtx.fillStyle = `rgba(90,90,90,${0.05 + rng() * 0.1})`;
    hCtx.fillRect(nx, ny, 2, 2);
  }

  const map = new THREE.CanvasTexture(albedo);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(4, 3);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalFromHeight(height));
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(4, 3);
  normalMap.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(albedo);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(4, 3);

  return { map, normalMap, roughnessMap };
}

/** Convert a grayscale height canvas into an RGB normal map. */
function normalFromHeight(src: HTMLCanvasElement, strength = 2.2): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext("2d")!;
  const sd = sctx.getImageData(0, 0, w, h);
  const out = makeCanvas(w, h);
  const octx = out.getContext("2d")!;
  const od = octx.createImageData(w, h);
  const at = (x: number, y: number) => {
    const cx = (x + w) % w;
    const cy = (y + h) % h;
    return sd.data[(cy * w + cx) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      od.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      od.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      od.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      od.data[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

function makeLabelTexture(name: string, role: string, accent: string): THREE.CanvasTexture {
  const c = makeCanvas(512, 128);
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 128);
  const w = 490;
  const h = 92;
  const x = (512 - w) / 2;
  const y = (128 - h) / 2 + 6;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 46);
  ctx.fillStyle = "rgba(18,20,30,0.62)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 42, y + h / 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 44px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + 66, y + 26);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  ctx.fillText(role.toUpperCase(), x + 66, y + 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMicTexture(): THREE.CanvasTexture {
  const c = makeCanvas(128, 64);
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
  const c = makeCanvas(512, 256);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#6db3ff");
  g.addColorStop(0.55, "#b7ddff");
  g.addColorStop(0.82, "#f3e9c8");
  g.addColorStop(1, "#f7e6b8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  const halo = ctx.createRadialGradient(400, 60, 8, 400, 60, 90);
  halo.addColorStop(0, "rgba(255,246,210,0.95)");
  halo.addColorStop(1, "rgba(255,246,210,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(300, 0, 210, 150);
  ctx.fillStyle = "#fff8d8";
  ctx.beginPath();
  ctx.arc(400, 60, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const [cx, cy, cr] of [
    [120, 72, 16],
    [150, 80, 11],
    [240, 130, 13],
    [268, 136, 9],
    [460, 150, 12],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.12, 16), darkMat);
  cap.position.y = 1.5;
  cap.castShadow = true;
  group.add(cap);

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

// ─── Local player avatar (stylized, KayKit-flavoured) ──────────────────────────
function buildLocalAvatar(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#3f7c8a", roughness: 0.55 });
  const mat2 = new THREE.MeshStandardMaterial({ color: "#e8b98a", roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: "#2b2f3a", roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.52, 8, 16), mat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  const legGeo = new THREE.CapsuleGeometry(0.09, 0.42, 6, 12);
  for (const side of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.set(side, 0.29, 0);
    leg.castShadow = true;
    g.add(leg);
  }

  const armGeo = new THREE.CapsuleGeometry(0.07, 0.36, 6, 12);
  for (const side of [-0.42, 0.42]) {
    const arm = new THREE.Mesh(armGeo, mat);
    arm.position.set(side, 1.04, 0);
    arm.castShadow = true;
    g.add(arm);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 20), mat2);
  head.position.y = 1.4;
  head.castShadow = true;
  g.add(head);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.14, 16), mat);
  cap.position.y = 1.56;
  cap.castShadow = true;
  g.add(cap);

  return g;
}

// ─── KayKit asset loader (cached, shared geometry/materials) ───────────────────
const kaykitCache = new Map<string, Promise<THREE.Group>>();

function configureKayKit(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.flatShading = true;
      mat.metalness = 0;
      mat.roughness = 0.55;
      mat.envMapIntensity = 0.55;
      mat.needsUpdate = true;
      if (mat.map) {
        mat.map.anisotropy = 8;
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
  });
}

function loadKayKit(name: string): Promise<THREE.Group> {
  const url = `${KAYKIT_BASE}/${name}.gltf`;
  if (!kaykitCache.has(url)) {
    kaykitCache.set(
      url,
      new Promise((resolve, reject) => {
        new GLTFLoader().load(
          url,
          (gltf) => {
            const root = gltf.scene.clone(true);
            configureKayKit(root);
            resolve(root);
          },
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err)))
        );
      })
    );
  }
  return kaykitCache.get(url)!;
}
// ─── Room ──────────────────────────────────────────────────────────────────────
export class DesignersRoom {
  private container: HTMLElement;
  private opts: RoomOptions;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private clock = new THREE.Timer();
  private raf = 0;
  private disposed = false;

  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  // spawn near the door, scattered so people don't start inside each other
  private px = (Math.random() * 2 - 1) * 2.5;
  private pz = 4.6 + Math.random() * 2;

  // follow-camera smoothing state
  private camYaw = 0;
  private camPitch = 0;
  private moveAmt = 0;

  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;

  private remotes = new Map<string, RemoteAvatar>();
  private colliders: Collider[] = [];

  private playerGroup: THREE.Group;
  private furnitureReady = false;
  private furnitureError: string | null = null;

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: RoomOptions) {
    this.container = container;
    this.opts = opts;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      opts.onError("WebGL is not available in this browser.");
      throw err;
    }
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "crosshair";
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#f3e7d2");
    this.scene.fog = new THREE.Fog("#f3e7d2", 22, 50);

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 100);

// post-processing (defensive — fall back to direct render if unavailable).
    // NOTE: GTAOPass was evaluated but black-screens on some Apple GPUs (its
    // DepthStencil/UnsignedInt248 depth texture sampling), so AO grounding is
    // done with cheap contact-shadow blobs instead — see addContactShadow().
    try {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.85, 0.86));
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch {
      this.composer = null;
    }

    this.playerGroup = buildLocalAvatar();
    this.scene.add(this.playerGroup);

    this.buildEnvironment();
    this.buildLights();
    this.buildRoom();
    void this.initFurniture();

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    renderer.domElement.addEventListener("contextmenu", this.onContextMenu);
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  start() {
    if (this.raf) return;
    this.clock.reset();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.clock.update();
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.getElapsed();
      this.updatePlayer(dt);
      this.updateLocalAvatar(t);
      this.updateCamera(dt, t);
      this.updateRemotes(dt, t);
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      this.emitFrame();
      if (!this.readyEmitted) {
        // gate onReady on the KayKit furniture arriving (architecture is ready
        // immediately) — never leave the HUD spinning forever.
        const elapsed = this.clock.getElapsed();
        if (this.furnitureReady || elapsed > 10) {
          this.readyEmitted = true;
          if (this.furnitureError) this.opts.onError(this.furnitureError);
          this.opts.onReady();
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    this.resizeObserver.disconnect();
    this.composer?.dispose();
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
    this.yaw -= dx * 0.0032;
    this.pitch -= dy * 0.0032;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
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
    this.composer?.setSize(w, h);
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

  // ── Movement + collision ─────────────────────────────────────────────────────
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
    const speed = (sprint ? 5.4 : 3.1) * dt;
    const len = Math.hypot(f, r);
    this.moveAmt = len;
    if (len > 0.01) {
      const nf = f / len;
      const nr = r / len;
      this.px += (-Math.sin(this.yaw) * nf + Math.cos(this.yaw) * nr) * speed;
      this.pz += (-Math.cos(this.yaw) * nf - Math.sin(this.yaw) * nr) * speed;
    }
    // walls
    const m = 0.45;
    this.px = Math.max(-HALF_W + m, Math.min(HALF_W - m, this.px));
    this.pz = Math.max(-HALF_D + m, Math.min(HALF_D - m, this.pz));
    // static furniture
    for (const c of this.colliders) {
      const dx = this.px - c.x;
      const dz = this.pz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.42;
      if (d < min && d > 0.0001) {
        this.px = c.x + (dx / d) * min;
        this.pz = c.z + (dz / d) * min;
      }
    }
  }

  private updateLocalAvatar(t: number) {
    this.playerGroup.position.set(this.px, 0, this.pz);
    this.playerGroup.rotation.y = this.yaw;
    this.playerGroup.position.y = Math.sin(t * 2.4) * 0.02 * Math.min(1, this.moveAmt * 1.4);
  }

  // ── Third-person follow camera ───────────────────────────────────────────────
  private updateCamera(dt: number, t: number) {
    // damped rotation so the camera eases behind the character
    let dy = this.yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * Math.min(1, dt * 12);
    this.camPitch += (this.pitch - this.camPitch) * Math.min(1, dt * 10);

    const dist = 3.0;
    let cx = this.px + Math.sin(this.camYaw) * dist;
    let cz = this.pz + Math.cos(this.camYaw) * dist;
    let cy = EYE - Math.sin(this.camPitch) * 1.5;

    // subtle head-bob while walking
    const bob = Math.sin(t * 9.0) * 0.035 * Math.min(1, this.moveAmt * 1.6);
    cy += bob;

    // camera collision: stay inside the room and away from furniture
    const m = 0.55;
    cx = Math.max(-HALF_W + m, Math.min(HALF_W - m, cx));
    cz = Math.max(-HALF_D + m, Math.min(HALF_D - m, cz));
    for (const c of this.colliders) {
      const dx = cx - c.x;
      const dz = cz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.55;
      if (d < min && d > 0.0001) {
        cx = c.x + (dx / d) * min;
        cz = c.z + (dz / d) * min;
      }
    }
    cy = Math.max(0.55, Math.min(WALL_H - 0.35, cy));
    this.camera.position.set(cx, cy, cz);

    // look slightly ahead of the character
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const ty = 1.45 + Math.sin(this.camPitch) * 1.1;
    this.camera.lookAt(this.px + fx * 3.2, ty, this.pz + fz * 3.2);

    // natural FOV with a small sprint kick
    const targetFov = this.keys.has("shift") ? 73 : 66;
    if (Math.abs(targetFov - this.camera.fov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
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

  // ── Environment (IBL) ────────────────────────────────────────────────────────
  private buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();

    // warm gradient sky dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 12),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide })
    );
    env.add(dome);

    // light panels: bright warm "window" side + soft overhead + cool accent
    const panel = (w: number, h: number, color: number, x: number, y: number, z: number, rx = 0, ry = 0) => {
      const p = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color })
      );
      p.position.set(x, y, z);
      p.rotation.x = rx;
      p.rotation.y = ry;
      env.add(p);
    };
    panel(12, 4.4, 0xfff0d0, 0, 2.8, -9, 0, 0); // window daylight
    panel(10, 3, 0xfff6e0, 0, 6, 0, Math.PI / 2, 0); // ceiling (faces down)
    panel(5, 3, 0xdce9ff, 8, 2.6, 0, 0, -Math.PI / 2); // cool accent

    const rt = pmrem.fromScene(env, 0.04);
    this.scene.environment = rt.texture;
    pmrem.dispose();
  }

  // ── Lighting hierarchy ───────────────────────────────────────────────────────
  private buildLights() {
    // main daylight — strong directional sun through the window (back wall)
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.position.set(3, 9, -13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 34;
    const s = 13.5;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.05;
    sun.shadow.radius = 8;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // environment + fill
    const hemi = new THREE.HemisphereLight(0xfff1df, 0xb5a692, 0.6);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0xfff6ea, 0.14));

    // warm interior — the floor lamp
    const lampLight = new THREE.PointLight(0xffb066, 0.7, 8, 2);
    lampLight.position.set(2.7, 2.0, -5.5);
    this.scene.add(lampLight);

    // cool accent — monitor glow at the workstation
    const cool = new THREE.PointLight(0x9fd0ff, 0.4, 6, 2);
    cool.position.set(-6.6, 1.7, -2.4);
    this.scene.add(cool);
  }

  private addCollider(x: number, z: number, r: number) {
    this.colliders.push({ x, z, r });
  }

  private contactShadowTex: THREE.CanvasTexture | null = null;

  // soft radial "contact AO" blob used to ground furniture on the floor
  // (a cheap, reliable replacement for a screen-space AO pass)
  private addContactShadow(x: number, z: number, rx: number, rz: number, opacity = 0.32) {
    if (!this.contactShadowTex) {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
      grad.addColorStop(0, "rgba(20,12,4,1)");
      grad.addColorStop(1, "rgba(20,12,4,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this.contactShadowTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this.contactShadowTex,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.renderOrder = 2;
    this.scene.add(m);
  }

  private std(color: string, rough = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }

  // ── Room architecture (walls / floor / window — primitives are fine here) ───
  private buildRoom() {
    const wood = makeWoodMaps();
    const floorMat = new THREE.MeshStandardMaterial({
      map: wood.map,
      normalMap: wood.normalMap,
      roughnessMap: wood.roughnessMap,
      roughness: 0.9,
    });
    const wallMat = new THREE.MeshStandardMaterial({ color: "#f2e5cf", roughness: 0.96 });
    const trimMat = new THREE.MeshStandardMaterial({ color: "#c9a87f", roughness: 0.8 });

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

    // baseboards
    const mkTrim = (w: number, d: number, x: number, z: number) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.26, d), trimMat);
      t.position.set(x, 0.13, z);
      t.receiveShadow = true;
      this.scene.add(t);
    };
    mkTrim(HALF_W * 2 - 0.2, 0.08, 0, -HALF_D + 0.15);
    mkTrim(HALF_W * 2 - 0.2, 0.08, 0, HALF_D - 0.15);
    mkTrim(0.08, HALF_D * 2 - 0.2, -HALF_W + 0.15, 0);
    mkTrim(0.08, HALF_D * 2 - 0.2, HALF_W - 0.15, 0);

    // ceiling
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: "#fff8ec", roughness: 1 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    this.scene.add(ceil);

    // window on the back wall + sky outside
    const frameMat = new THREE.MeshStandardMaterial({ color: "#8a5a33", roughness: 0.85 });
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(10, 3.0, 0.26), frameMat);
    winFrame.position.set(0, 2.5, -HALF_D + 0.2);
    winFrame.castShadow = true;
    this.scene.add(winFrame);

    // glass
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(9.1, 2.35),
      new THREE.MeshStandardMaterial({
        color: "#cfe4ff",
        transparent: true,
        opacity: 0.16,
        roughness: 0.05,
        metalness: 0.1,
        side: THREE.DoubleSide,
      })
    );
    glass.position.set(0, 2.5, -HALF_D + 0.36);
    this.scene.add(glass);

    // mullions
    const mullMat = new THREE.MeshStandardMaterial({ color: "#b98f63", roughness: 0.8 });
    for (const mx of [-3.4, 0, 3.4]) {
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.4, 0.12), mullMat);
      mull.position.set(mx, 2.5, -HALF_D + 0.3);
      mull.castShadow = true;
      this.scene.add(mull);
    }
    const hMull = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.09, 0.12), mullMat);
    hMull.position.set(0, 1.6, -HALF_D + 0.3);
    hMull.castShadow = true;
    this.scene.add(hMull);

    // window sill
    const sill = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.12, 0.5), frameMat);
    sill.position.set(0, 1.12, -HALF_D + 0.38);
    sill.castShadow = true;
    this.scene.add(sill);

    // sky + ground outside the window
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 12),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture(), fog: false })
    );
    sky.position.set(0, 3.6, -HALF_D - 3.4);
    this.scene.add(sky);
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 30),
      new THREE.MeshBasicMaterial({ color: "#c3d2a6", fog: false })
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(0, -0.04, -HALF_D - 12);
    this.scene.add(outside);

    // door on the front wall
    const doorMat = new THREE.MeshStandardMaterial({ color: "#b98a5a", roughness: 0.8 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.2, 0.34), doorMat);
    door.position.set(-8.6, 1.6, HALF_D - 0.16);
    door.castShadow = true;
    this.scene.add(door);
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.5, 0.3), trimMat);
    frameL.position.set(-9.68, 1.75, HALF_D - 0.12);
    this.scene.add(frameL);
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.5, 0.3), trimMat);
    frameR.position.set(-7.52, 1.75, HALF_D - 0.12);
    this.scene.add(frameR);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshStandardMaterial({ color: "#c9a24b", metalness: 0.7, roughness: 0.3 })
    );
    knob.position.set(-8.6 + 0.7, 1.55, HALF_D - 0.28);
    this.scene.add(knob);

    // recessed ceiling lights (subtle bloom sources)
    const mkCeilLight = (x: number, z: number, w: number) => {
      const l = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.05, 0.7),
        new THREE.MeshStandardMaterial({
          color: "#fff4d8",
          emissive: "#fff4d8",
          emissiveIntensity: 1.4,
        })
      );
      l.position.set(x, WALL_H - 0.02, z);
      this.scene.add(l);
    };
    mkCeilLight(0, 0, 1.7);
    mkCeilLight(-6.5, 2.5, 1.3);

    this.buildFurnitureShell();
  }

  // ── KayKit furniture (few, strong assets) ────────────────────────────────────
  private async initFurniture() {
    const names = [
      "couch_pillows",
      "armchair_pillows",
      "table_low",
      "table_medium",
      "table_small",
      "chair_B",
      "lamp_standing",
      "lamp_table",
      "cactus_medium_A",
      "cactus_small_A",
      "rug_rectangle_A",
      "shelf_B_large_decorated",
      "pictureframe_medium",
      "book_set",
    ];
    const settled = await Promise.allSettled(names.map((n) => loadKayKit(n)));
    const got = new Map<string, THREE.Group>();
    let firstErr = "";
    for (let i = 0; i < names.length; i++) {
      const s = settled[i];
      if (s.status === "fulfilled") got.set(names[i], s.value);
      else if (s.status === "rejected" && !firstErr) firstErr = String(s.reason);
    }
    if (got.size === 0) {
      this.furnitureError = `Couldn't load the studio furniture. ${firstErr}`;
      this.furnitureReady = true;
      return;
    }
    this.placeFurniture(got);
    this.furnitureReady = true;
  }

  private place(asset: THREE.Group, x: number, z: number, yaw: number, opts?: { y?: number; s?: number }) {
    const g = asset.clone();
    g.position.set(x, opts?.y ?? 0, z);
    g.rotation.y = yaw;
    if (opts?.s) g.scale.setScalar(opts.s);
    this.scene.add(g);
    return g;
  }

  private buildFurnitureShell() {
    // place everything that does not need network assets first (monitors, glows)
    this.buildWorkstation();
  }

  private buildWorkstation() {
    // monitor on the desk (no KayKit monitor exists — a screen is "electronics")
    const monitor = new THREE.Group();
    const dark = this.std("#20222e", 0.6);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), dark);
    stand.position.y = 0.22;
    stand.castShadow = true;
    monitor.add(stand);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), dark);
    base.position.y = 0.04;
    base.castShadow = true;
    monitor.add(base);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 1.05), dark);
    panel.position.y = 0.62;
    panel.castShadow = true;
    monitor.add(panel);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.5),
      new THREE.MeshBasicMaterial({ color: "#8fc2ff" })
    );
    screen.position.set(0, 0.62, 0.53);
    monitor.add(screen);
    monitor.position.set(-6.6, 1.0, -2.55);
    this.scene.add(monitor);
  }

  private placeFurniture(got: Map<string, THREE.Group>) {
    const p = (name: string, x: number, z: number, yaw: number, opts?: { y?: number; s?: number }) => {
      const a = got.get(name);
      if (a) this.place(a, x, z, yaw, opts);
    };

    // ── social area (primary focal point): sofa + armchair + coffee table + rug
    p("rug_rectangle_A", 4.7, -3.9, 0);
    p("couch_pillows", 5.6, -5.0, Math.PI);
    p("armchair_pillows", 7.4, -2.9, -Math.PI / 2);
    p("table_low", 4.7, -3.5, 0);
    p("book_set", 4.45, -3.45, 0.5, { y: 0.75 }); // on the coffee table
    p("lamp_standing", 2.9, -5.6, 0);

    // contact shadows ground the social pieces
    this.addContactShadow(5.6, -5.0, 1.7, 0.95);
    this.addContactShadow(7.4, -2.9, 1.0, 0.9);
    this.addContactShadow(4.7, -3.5, 1.35, 0.9);
    this.addContactShadow(2.9, -5.6, 0.55, 0.55);
    this.addContactShadow(10.2, 6.5, 0.75, 0.75);
    this.addContactShadow(9.6, -6.7, 0.55, 0.55);

    // ── workstation (secondary area)
    p("table_medium", -6.6, -2.8, 0); // desk
    p("chair_B", -6.6, -1.1, Math.PI);
    p("cactus_small_A", -7.2, -2.9, 0.6, { y: 1.0 }); // on the desk

    // ── bookshelf (left wall)
    p("shelf_B_large_decorated", -11.7, 1.6, Math.PI / 2, { y: 0.1 });
    this.addContactShadow(-11.7, 1.6, 1.15, 0.45);

    // ── corner accent (right-front): side table + table lamp
    p("table_small", 10.2, 6.5, 0);
    p("lamp_table", 10.2, 6.5, 0.4, { y: 1.0 });

    // ── plant by the window
    p("cactus_medium_A", 9.6, -6.7, 0.3);

    // ── wall art (KayKit picture frames replace the old poster planes)
    p("pictureframe_medium", -6.5, -8.75, 0, { y: 2.3 });
    p("pictureframe_medium", 6.5, -8.75, 0, { y: 2.3 });
    p("pictureframe_medium", 11.75, 2.6, -Math.PI / 2, { y: 2.3 });
    p("pictureframe_medium", 2.2, 8.75, Math.PI, { y: 2.3 });

    // ── colliders so the player and camera can't walk through furniture
    this.addCollider(5.6, -5.0, 1.85); // couch
    this.addCollider(7.4, -2.9, 1.05); // armchair
    this.addCollider(4.7, -3.5, 1.5); // coffee table
    this.addCollider(2.9, -5.6, 0.5); // floor lamp
    this.addCollider(-6.6, -2.8, 1.6); // desk
    this.addCollider(-6.6, -1.1, 0.7); // chair
    this.addCollider(-11.7, 1.6, 1.15); // bookshelf
    this.addCollider(10.2, 6.5, 0.75); // side table
    this.addCollider(9.6, -6.7, 0.5); // plant

    // lamp glows (light sources — primitives are fine)
    this.addGlow(2.9, 2.05, -5.6); // floor lamp bulb
    this.addGlow(10.2, 1.9, 6.5); // table lamp bulb
  }

  private addGlow(x: number, y: number, z: number) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 10),
      new THREE.MeshBasicMaterial({ color: "#ffd9a0" })
    );
    bulb.position.set(x, y, z);
    this.scene.add(bulb);
  }
}
