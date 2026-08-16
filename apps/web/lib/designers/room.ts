/**
 * 3D "Hidden Alley" social room engine (plain three.js).
 *
 * The environment is the Poly Haven "Hidden Alley" scene (CC0) baked down to a
 * single self-contained GLB (`apps/web/public/designers/hidden-alley/`). The
 * .blend source and original 400+ textures are gitignored under
 * `apps/web/lib/designers/hidden_alley/source/`; only the Draco-compressed GLB
 * (geometry preserved 1:1, textures re-encoded as WebP) plus the
 * `flower_hillside_1k.hdr` environment map are shipped to the browser.
 *
 * Rendering: WebGPU/`WebGPURenderer` is preferred with a TSL post pipeline
 * (pass → bloom → tone-mapped output) and an automatic WebGL2 fallback that
 * reuses the proven `EffectComposer → RenderPass → UnrealBloomPass →
 * OutputPass` chain. WebGPU is only adopted if it initializes AND passes a
 * tiny render-backend probe; any failure drops straight to WebGL2 so the room
 * always renders. The GPU selection probe keeps us honest on Apple GPUs where
 * fancy post passes (GTAO/SSAO) have black-screened in the past.
 *
 * React (`DesignersRoom.tsx`) stays responsible for the HUD, voice (WebRTC),
 * presence and input plumbing; all three.js state lives here.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { WebGPURenderer, PostProcessing } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";

// ─── Alley constants ─────────────────────────────────────────────────────────
const ALLEY_GLB = "/designers/hidden-alley/hidden-alley.glb";
const HDR_URL = "/designers/hidden-alley/flower_hillside_1k.hdr";
const DRACO_PATH = "/draco/";

// Walkable street footprint in three.js space (Blender z-up is converted to
// glTF y-up by the exporter, so the alley's long axis runs along ±Z).
const ALLEY_MIN_X = -4.6;
const ALLEY_MAX_X = 4.6;
const ALLEY_MIN_Z = -13.8;
const ALLEY_MAX_Z = 8.2;
const EYE = 1.62; // player eye height

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

// Curated colliders for the major street clutter (barrels, gate, barriers,
// lamps, crates, plants …) so players and the camera don't clip props.
// Coordinates converted from the Blender scene (Blender +Y → −Z).
const ALLEY_COLLIDERS: Collider[] = [
  { x: 0, z: 5.0, r: 0.55 }, // large iron gate face (south dead-end)
  { x: 1.0, z: 5.0, r: 0.55 }, // gate — extend the wall across its width
  { x: -1.0, z: 5.0, r: 0.55 }, // gate — extend the wall across its width
  { x: 0.85, z: 4.55, r: 1.0 }, // concrete road barrier
  { x: -1.1, z: 4.55, r: 1.0 }, // concrete road barrier
  { x: -1.65, z: 5.79, r: 0.4 }, // street lamp
  { x: -4.0, z: -6.97, r: 0.45 }, // street lamp
  { x: 2.15, z: -13.73, r: 0.35 }, // street lamp
  { x: -1.65, z: -13.73, r: 0.35 }, // street lamp
  { x: 2.8, z: -3.48, r: 0.5 }, // barrel stove
  { x: 3.65, z: -3.92, r: 0.45 }, // barrel 02
  { x: 3.5, z: -3.42, r: 0.5 }, // barrel 03
  { x: 3.95, z: -3.84, r: 0.35 }, // power box
  { x: 1.5, z: -2.81, r: 0.45 }, // trash can
  { x: 1.6, z: -2.31, r: 0.35 }, // fire hydrant
  { x: 1.6, z: -0.5, r: 0.35 }, // utility box 01
  { x: -2.25, z: 3.58, r: 0.4 }, // utility box 02 (south)
  { x: 1.6, z: -1.09, r: 0.4 }, // television
  { x: 1.2, z: -2.32, r: 0.35 }, // cardboard box
  { x: -2.3, z: -9.26, r: 0.85 }, // tree stump
  { x: -2.6, z: -11.4, r: 1.3 }, // outdoor table + chairs
  { x: -2.6, z: -11.33, r: 0.35 }, // boombox
  { x: -2.4, z: -8.98, r: 0.5 }, // old tyre
  { x: 3.9, z: -11.4, r: 0.5 }, // rusted wheel rims
  { x: -1.5, z: -13.81, r: 0.35 }, // planter pot
  { x: -1.9, z: -13.79, r: 0.4 }, // potted plant
  { x: -3.2, z: -5.9, r: 0.4 }, // potted plant
  { x: -2.5, z: -13.63, r: 0.45 }, // rusted trash can
  { x: 2.85, z: -13.62, r: 0.45 }, // utility box 02 (north)
];

// ─── Remote (real user) avatar ──────────────────────────────────────────────
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

function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 52%)`;
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
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

// ─── Local player avatar ────────────────────────────────────────────────────
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

// ─── Room ───────────────────────────────────────────────────────────────────
type AnyRenderer = THREE.WebGLRenderer | WebGPURenderer;

export class DesignersRoom {
  private container: HTMLElement;
  private opts: RoomOptions;
  private renderer: AnyRenderer | null = null;
  private backend: "webgpu" | "webgl2" | null = null;
  private composer: EffectComposer | null = null;
  private gpuPost: PostProcessing | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Timer();
  private raf = 0;
  private disposed = false;

  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  // spawn in the open alley just north of the gate (room for the follow cam)
  private px = (Math.random() * 2 - 1) * 1.2;
  private pz = -1.5 + Math.random() * 0.4;

  // follow-camera smoothing state
  private camYaw = 0;
  private camPitch = 0;
  private moveAmt = 0;

  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;

  private remotes = new Map<string, RemoteAvatar>();
  private colliders: Collider[] = ALLEY_COLLIDERS;

  private playerGroup: THREE.Group;
  private alleyReady = false;
  private alleyError: string | null = null;

  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: RoomOptions) {
    this.container = container;
    this.opts = opts;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog("#2e3340", 16, 55);
    // the flower-hillside HDRI is a sunny daylight env; keep it as sky + IBL but
    // scale its ambient contribution way down so the alley reads as warm dusk
    this.scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 120);

    this.playerGroup = buildLocalAvatar();
    this.scene.add(this.playerGroup);

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("contextmenu", this.onContextMenu);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  start() {
    if (this.raf) return;
    this.clock.reset();
    void this.boot();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
    this.resizeObserver.disconnect();
    this.composer?.dispose();
    if (this.renderer?.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer?.dispose();
    this.renderer = null;
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

  // ── Boot (WebGPU preferred, WebGL2 fallback) ──────────────────────────────
  private async boot() {
    if (this.disposed) return;
    const forcedWebGL2 = (globalThis as { __UX_FORCE_WEBGL2__?: boolean }).__UX_FORCE_WEBGL2__ === true;
    const hasGPU = (navigator as unknown as { gpu?: unknown }).gpu != null;
    const win = globalThis as { __UX_BACKEND__?: string };

    if (!forcedWebGL2 && hasGPU) {
      const gpu = await this.tryBootWebGPU();
      if (gpu && !this.disposed) {
        this.backend = "webgpu";
        win.__UX_BACKEND__ = "webgpu";
        this.renderer = gpu.renderer;
        this.gpuPost = gpu.post;
        this.configureRenderer(gpu.renderer);
        this.buildEnvironment();
        this.buildLights();
        this.loadAlley();
        this.startLoop();
        return;
      }
    }

    if (this.disposed) return;
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
      this.backend = "webgl2";
      win.__UX_BACKEND__ = "webgl2";
      this.renderer = renderer;
      this.configureRenderer(renderer);
      // post-processing (defensive — fall back to direct render if unavailable)
      try {
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.18, 0.85, 0.86));
        composer.addPass(new OutputPass());
        this.composer = composer;
      } catch {
        this.composer = null;
      }
      this.buildEnvironment();
      this.buildLights();
      this.loadAlley();
      this.startLoop();
    } catch (err) {
      this.opts.onError("WebGL is not available in this browser.");
      throw err;
    }
  }

  /** Try WebGPU + TSL post; returns null if it can't be trusted to render. */
  private async tryBootWebGPU(): Promise<{ renderer: WebGPURenderer; post: PostProcessing } | null> {
    try {
      const renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
      // software WebGPU (e.g. SwiftShader in headless Chrome) can hang during
      // init/compile — time-box the whole attempt so we fall back to WebGL2
      await withTimeout(renderer.init(), 4000);
      const probeOk = await withTimeout(probeWebGPUBackend(renderer), 4000);
      if (!probeOk) {
        renderer.dispose();
        return null;
      }
      const post = new PostProcessing(renderer);
      // documented TSL pattern: scene color + bloom overlay (renderOutput for
      // tone mapping / color space is applied automatically by the pipeline)
      const scenePass = pass(this.scene, this.camera);
      const scenePassColor = scenePass.getTextureNode("output");
      const bloomPass = bloom(scenePassColor, 0.5, 0.85, 0.6);
      post.outputNode = scenePassColor.add(bloomPass);
      return { renderer, post };
    } catch {
      return null;
    }
  }

  private configureRenderer(renderer: AnyRenderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.7;
    const dom = renderer.domElement;
    dom.style.display = "block";
    dom.style.touchAction = "none";
    dom.style.cursor = "crosshair";
    this.container.appendChild(dom);
    this.resize();
  }

  private startLoop() {
    if (this.disposed || this.raf) return;
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
      void this.renderFrame();
      this.emitFrame();
      if (!this.readyEmitted) {
        // gate onReady on the alley arriving (architecture is ready immediately)
        const elapsed = this.clock.getElapsed();
        if (this.alleyReady || elapsed > 25) {
          this.readyEmitted = true;
          if (this.alleyError) this.opts.onError(this.alleyError);
          this.opts.onReady();
        }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async renderFrame() {
    if (this.disposed || !this.renderer) return;
    if (this.backend === "webgpu" && this.gpuPost) {
      await this.gpuPost.render();
    } else if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────
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
    this.renderer?.setSize(w, h);
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

  // ── Movement + collision ───────────────────────────────────────────────────
  private clampToAlley(x: number, z: number, m: number) {
    return {
      x: Math.max(ALLEY_MIN_X + m, Math.min(ALLEY_MAX_X - m, x)),
      z: Math.max(ALLEY_MIN_Z + m, Math.min(ALLEY_MAX_Z - m, z)),
    };
  }

  private collide(x: number, z: number, m: number) {
    let ox = x;
    let oz = z;
    for (const c of this.colliders) {
      const dx = ox - c.x;
      const dz = oz - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + m;
      if (d < min && d > 0.0001) {
        ox = c.x + (dx / d) * min;
        oz = c.z + (dz / d) * min;
      }
    }
    return { x: ox, z: oz };
  }

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
    // alley bounds + static props
    const m = 0.42;
    const a = this.clampToAlley(this.px, this.pz, m);
    this.px = a.x;
    this.pz = a.z;
    const c = this.collide(this.px, this.pz, m);
    this.px = c.x;
    this.pz = c.z;
  }

  private updateLocalAvatar(t: number) {
    this.playerGroup.position.set(this.px, 0, this.pz);
    this.playerGroup.rotation.y = this.yaw;
    this.playerGroup.position.y = Math.sin(t * 2.4) * 0.02 * Math.min(1, this.moveAmt * 1.4);
  }

  // ── Third-person follow camera ─────────────────────────────────────────────
  private updateCamera(dt: number, t: number) {
    let dy = this.yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * Math.min(1, dt * 12);
    this.camPitch += (this.pitch - this.camPitch) * Math.min(1, dt * 10);

    const dist = 3.4;
    let cx = this.px + Math.sin(this.camYaw) * dist;
    let cz = this.pz + Math.cos(this.camYaw) * dist;
    let cy = EYE - Math.sin(this.camPitch) * 1.5;

    // subtle head-bob while walking
    const bob = Math.sin(t * 9.0) * 0.035 * Math.min(1, this.moveAmt * 1.6);
    cy += bob;

    // camera collision: stay inside the alley and off the props
    const m = 0.55;
    const a = this.clampToAlley(cx, cz, m);
    cx = a.x;
    cz = a.z;
    const c = this.collide(cx, cz, m);
    cx = c.x;
    cz = c.z;
    // the iron gate walls off the south end — keep the camera on the alley side
    cz = Math.min(cz, 1.9);
    cy = Math.max(0.55, Math.min(8, cy));
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

  // ── Environment (HDR image-based lighting) ─────────────────────────────────
  private buildEnvironment() {
    // equirect HDR from the source scene doubles as the sky background and the
    // IBL environment. If it fails, fall back to a soft procedural dusk.
    new HDRLoader()
      .loadAsync(HDR_URL)
      .then((tex) => {
        if (this.disposed) return;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pmrem = new THREE.PMREMGenerator(this.renderer as unknown as THREE.WebGLRenderer);
        const rt = pmrem.fromEquirectangular(tex);
        pmrem.dispose();
        this.scene.environment = rt.texture;
        this.scene.background = tex;
      })
      .catch(() => this.buildProceduralEnvironment());
  }

  private buildProceduralEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer as unknown as THREE.WebGLRenderer);
    const env = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(40, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x2a3040, side: THREE.BackSide })
    );
    env.add(dome);
    // cool top / warm horizon panels to fake the alley's dusk sky
    const panel = (w: number, h: number, color: number, x: number, y: number, z: number) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
      p.position.set(x, y, z);
      env.add(p);
    };
    panel(20, 6, 0x44506b, 0, 4, -20);
    panel(20, 6, 0xffc88a, 0, -2, -20);
    const rt = pmrem.fromScene(env, 0.04);
    this.scene.environment = rt.texture;
    this.scene.background = new THREE.Color("#232a38");
    pmrem.dispose();
  }

  // ── Lighting (atmospheric urban dusk, inspired by the source scene) ────────
  private buildLights() {
    // key — warm late-day sun from the south-west (matches Sun.005)
    const sun = new THREE.DirectionalLight(0xffc9a0, 1.8);
    sun.position.set(-14.5, 9.0, -10.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 50;
    const s = 16;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.05;
    if (this.backend === "webgl2") sun.shadow.radius = 8;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // cool sky fill + soft ground bounce
    const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x3a2f26, 0.35);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x6a7288, 0.14));

    // warm practical lights (replicates the source Area/Spot rig, shadowless)
    const warm = (x: number, y: number, z: number, intensity: number, distance: number, color = 0xffb26a) => {
      const l = new THREE.PointLight(color, intensity, distance, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
    };
    warm(0.02, 11.3, 2.8, 12, 30); // Area.001
    warm(-2.14, 10.2, -9.8, 18, 34, 0xff9c6b); // Area.003
    warm(1.42, 10.0, -19.4, 9, 26); // Area.004
    warm(0.89, 10.2, 2.59, 14, 30); // Area.005

    // cool practical spot (Area.002)
    const coolSpot = new THREE.SpotLight(0xcfe8ff, 14, 26, Math.PI / 4, 0.5, 1);
    coolSpot.position.set(-1.98, 2.12, 0.1);
    coolSpot.target.position.set(-1.98, 0, -2);
    this.scene.add(coolSpot);
    this.scene.add(coolSpot.target);
  }

  // ── Alley geometry (Draco-compressed GLB) ──────────────────────────────────
  private loadAlley() {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(draco);
    loader.load(
      ALLEY_GLB,
      (gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;
        root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            // foliage is kept out of the shadow pass (it dominates tri count)
            const name = mesh.name.toLowerCase();
            const foliage = /grass|leaf|leaves|ivy|weed|branch|stem|foliage/.test(name);
            mesh.castShadow = !foliage;
            mesh.receiveShadow = true;
          }
        });
        this.scene.add(root);
        this.alleyReady = true;
      },
      undefined,
      (err) => {
        this.alleyError = err instanceof Error ? err.message : String(err);
        this.alleyReady = true;
      }
    );
  }
}

/**
 * Resolve `p` within `ms` or reject (used to bound the WebGPU probe so a
 * misbehaving/driver-level hang can never wedge the room's boot).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Render a trivial red quad to a small render target and read a pixel back.
 * Proves the WebGPU backend actually rasterizes on this device/browser before
 * we trust the whole room to it. Returns false on any failure so the caller
 * falls back to WebGL2.
 */
async function probeWebGPUBackend(renderer: WebGPURenderer): Promise<boolean> {
  try {
    const rt = new THREE.RenderTarget(4, 4);
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    cam.position.z = 2;
    sc.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      )
    );
    await renderer.compileAsync(sc, cam);
    renderer.setRenderTarget(rt);
    renderer.render(sc, cam);
    const data = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, 4, 4);
    renderer.setRenderTarget(null);
    rt.dispose();
    return data[0] > 200; // a clear red sample means the backend works
  } catch {
    return false;
  }
}