/**
 * 3D designer-studio room engine (plain three.js — no extra addons).
 *
 * The environment is the "Pixellab abandoned house" GLB loaded at runtime
 * with GLTFLoader. Its arbitrary authoring scale is normalised from the
 * model's real bounding box, the player spawns standing in front of it, and
 * the walkable area + house footprint are derived from the same bounds.
 * Handles: scene + lighting, first-person drag-look camera, WASD / touch
 * movement with collision, and network-driven avatars for other real users
 * in the room.
 * React (`DesignersRoom.tsx`) is only responsible for the HUD, voice (WebRTC)
 * and input plumbing — all three.js state lives here.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ─── Environment constants ────────────────────────────────────────────────────
const EYE = 1.62; // player eye height
const HOUSE_URL = "/designers/pixellabs-abandoned-house-3642.glb";
const HOUSE_TARGET_H = 6; // scale the (arbitrarily-sized) model to this height
const WALK_MARGIN = 4.5; // how far the player may roam around the house
const SPAWN_FRONT = 2.6; // spawn distance in front of the house footprint

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

// ─── Small texture helpers ─────────────────────────────────────────────────────
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
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.25, 0.12, 16),
    darkMat
  );
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
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  // spawn is chosen from the house bounding box once the GLB loads
  private px = 0;
  private pz = 4;

  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;

  private remotes = new Map<string, RemoteAvatar>();

  // house (GLB) state — derived from its real bounding box at load time
  private houseReady = false;
  private houseBox: THREE.Box3 | null = null;
  private minX = -20;
  private maxX = 20;
  private minZ = -20;
  private maxZ = 20;
  private houseCX = 0;
  private houseCZ = 0;
  private houseHX = 20;
  private houseHZ = 20;

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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "crosshair";
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1b2129");
    this.scene.fog = new THREE.Fog("#1b2129", 16, 40);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);

    this.buildLights();
    this.buildGround();
    this.loadHouse();

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
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;
      this.updatePlayer(dt);
      this.updateRemotes(dt, t);
      this.camera.position.set(this.px, EYE, this.pz);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      this.renderer.render(this.scene, this.camera);
      this.emitFrame();
      // hold the loading overlay until the environment is actually in the scene
      if (!this.readyEmitted && this.houseReady) {
        this.readyEmitted = true;
        this.opts.onReady();
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
    const sprint =
      this.keys.has("shift") || this.touchSprint;
    const speed = (sprint ? 5.4 : 3.1) * dt;
    const len = Math.hypot(f, r);
    if (len > 0.01) {
      const nf = f / len;
      const nr = r / len;
      this.px += (-Math.sin(this.yaw) * nf + Math.cos(this.yaw) * nr) * speed;
      this.pz += (-Math.cos(this.yaw) * nf - Math.sin(this.yaw) * nr) * speed;
    }
    // walkable grounds around the house
    const m = 0.45;
    this.px = Math.max(this.minX + m, Math.min(this.maxX - m, this.px));
    this.pz = Math.max(this.minZ + m, Math.min(this.maxZ - m, this.pz));
    // keep the player out of the house footprint (solid model)
    const dx = this.px - this.houseCX;
    const dz = this.pz - this.houseCZ;
    if (Math.abs(dx) < this.houseHX && Math.abs(dz) < this.houseHZ) {
      const overX = this.houseHX - Math.abs(dx);
      const overZ = this.houseHZ - Math.abs(dz);
      if (overX < overZ) this.px = this.houseCX + Math.sign(dx || 1) * this.houseHX;
      else this.pz = this.houseCZ + Math.sign(dz || 1) * this.houseHZ;
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

  // ── Scene building ───────────────────────────────────────────────────────────
  private buildLights() {
    // slightly boosted from the original bright studio so the dark house reads
    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x9a8f7c, 1.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe1b3, 1.5);
    sun.position.set(7, 10, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 30;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const warm = new THREE.PointLight(0xff9d5c, 1.2, 16);
    warm.position.set(0, 2.7, 5.5);
    this.scene.add(warm);

    const cool = new THREE.PointLight(0x9cc4ff, 0.6, 14);
    cool.position.set(0, 3.2, -6);
    this.scene.add(cool);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  }

  /** Dark yard floor so the house sits on something and casts a shadow. */
  private buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshStandardMaterial({ color: "#262b33", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  // ── House (GLB) ──────────────────────────────────────────────────────────────
  private loadHouse() {
    const loader = new GLTFLoader();
    loader.load(
      HOUSE_URL,
      (gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;
        root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        // The model is authored at an arbitrary scale and is not assumed to be
        // centered at (0,0,0) — normalise from its real bounding box.
        const rawBox = new THREE.Box3().setFromObject(root);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const scale = HOUSE_TARGET_H / rawSize.y;
        root.scale.setScalar(scale);
        this.scene.add(root);

        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        this.houseBox = box;
        this.houseReady = true;

        // walkable bounds around the house
        this.minX = center.x - size.x / 2 - WALK_MARGIN;
        this.maxX = center.x + size.x / 2 + WALK_MARGIN;
        this.minZ = center.z - size.z / 2 - WALK_MARGIN;
        this.maxZ = center.z + size.z / 2 + WALK_MARGIN;
        this.houseCX = center.x;
        this.houseCZ = center.z;
        this.houseHX = size.x / 2 - 0.5;
        this.houseHZ = size.z / 2 - 0.5;

        // spawn standing in front of the house (+z), scattered a little so
        // people don't start inside each other
        this.px = center.x + (Math.random() * 2 - 1) * 1.4;
        this.pz = center.z + size.z / 2 + SPAWN_FRONT + Math.random() * 1.4;
      },
      undefined,
      (err) => {
        console.error("Failed to load " + HOUSE_URL, err);
        this.opts.onError("Could not load the 3D environment.");
      }
    );
  }
}
