/**
 * 3D designer-studio room engine (plain three.js — no extra addons).
 *
 * Handles: scene + furniture building, first-person pointer-lock camera,
 * WASD / touch movement with collision, and network-driven avatars for
 * other real users in the room.
 * React (`DesignersRoom.tsx`) is only responsible for the HUD, voice (WebRTC)
 * and input plumbing — all three.js state lives here.
 */

import * as THREE from "three";

// ─── Room constants ───────────────────────────────────────────────────────────
const HALF_W = 12; // room half-width  (x: ±12)
const HALF_D = 9; // room half-depth   (z: ±9)
const WALL_H = 4.6;
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

// ─── Small texture helpers ─────────────────────────────────────────────────────
function makePlankTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#c99a68";
  ctx.fillRect(0, 0, 256, 256);
  // plank seams
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = "rgba(90,58,28,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(256, i * 64);
    ctx.stroke();
  }
  // staggered vertical joints
  ctx.strokeStyle = "rgba(90,58,28,0.25)";
  for (let row = 0; row < 4; row++) {
    const off = row % 2 === 0 ? 0 : 128;
    for (let x = 0; x < 4; x++) {
      ctx.beginPath();
      ctx.moveTo((x * 64 + off) % 256, row * 64);
      ctx.lineTo((x * 64 + off) % 256, row * 64 + 64);
      ctx.stroke();
    }
  }
  // grain noise
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(80,50,22,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 52%)`;
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
  private px = 0;
  private pz = 6.6;

  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchSprint = false;

  private remotes = new Map<string, RemoteAvatar>();
  private colliders: Collider[] = [];

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
    this.scene.background = new THREE.Color("#f2e7d3");
    this.scene.fog = new THREE.Fog("#f2e7d3", 22, 46);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);

    this.buildLights();
    this.buildRoom();

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
      if (!this.readyEmitted) {
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
    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x9a8f7c, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe1b3, 1.25);
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

    const warm = new THREE.PointLight(0xff9d5c, 0.9, 16);
    warm.position.set(0, 2.7, 5.5);
    this.scene.add(warm);

    const cool = new THREE.PointLight(0x9cc4ff, 0.4, 14);
    cool.position.set(0, 3.2, -6);
    this.scene.add(cool);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.16));
  }

  private addCollider(x: number, z: number, r: number) {
    this.colliders.push({ x, z, r });
  }

  private buildRoom() {
    const wallMat = new THREE.MeshStandardMaterial({ color: "#f4e9d6", roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({
      map: makePlankTexture(),
      roughness: 0.85,
    });

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
    // ceiling
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2),
      new THREE.MeshStandardMaterial({ color: "#fff8ec", roughness: 1 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    this.scene.add(ceil);

    // window on the back wall + sky outside
    const winFrame = new THREE.Mesh(
      new THREE.BoxGeometry(9, 2.6, 0.24),
      new THREE.MeshStandardMaterial({ color: "#e8d7b8", roughness: 0.9 })
    );
    winFrame.position.set(0, 2.35, -HALF_D + 0.18);
    this.scene.add(winFrame);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 2.0),
      new THREE.MeshStandardMaterial({
        color: "#cfe8ff",
        transparent: true,
        opacity: 0.22,
        roughness: 0.1,
        metalness: 0.2,
        side: THREE.DoubleSide,
      })
    );
    glass.position.set(0, 2.35, -HALF_D + 0.32);
    this.scene.add(glass);

    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 11),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture() })
    );
    sky.position.set(0, 3.4, -HALF_D - 3.6);
    this.scene.add(sky);

    // door on the front wall
    const doorMat = new THREE.MeshStandardMaterial({ color: "#b98a5a", roughness: 0.8 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.2, 0.34), doorMat);
    door.position.set(-8.6, 1.6, HALF_D - 0.16);
    this.scene.add(door);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshStandardMaterial({ color: "#c9a24b", metalness: 0.7, roughness: 0.3 })
    );
    knob.position.set(-8.6 + 0.7, 1.55, HALF_D - 0.28);
    this.scene.add(knob);

    this.buildFurniture();
  }

  private std(color: string, rough = 0.8) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }

  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rough = 0.8, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.std(color, rough));
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  private buildFurniture() {
    // ── rug ──
    const rug = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.3, 0.03, 48),
      this.std("#3e6fb0", 0.95)
    );
    rug.position.y = 0.02;
    rug.receiveShadow = true;
    this.scene.add(rug);
    const rugInner = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, 0.035, 48),
      this.std("#527fc2", 0.95)
    );
    rugInner.position.y = 0.035;
    rugInner.receiveShadow = true;
    this.scene.add(rugInner);

    // ── sofa ──
    const sofaX = 5.6;
    const sofaZ = -4.4;
    this.box(3.0, 0.55, 1.15, "#4a7c8a", sofaX, 0.45, sofaZ, 0.9);
    this.box(3.0, 0.75, 0.32, "#3f6b77", sofaX, 1.0, sofaZ + 0.42, 0.9);
    this.box(0.42, 0.75, 1.15, "#3f6b77", sofaX - 1.35, 0.95, sofaZ, 0.9);
    this.box(0.42, 0.75, 1.15, "#3f6b77", sofaX + 1.35, 0.95, sofaZ, 0.9);
    // cushions
    this.box(1.0, 0.24, 0.85, "#d8e4e6", sofaX - 0.72, 0.82, sofaZ - 0.05, 0.95);
    this.box(1.0, 0.24, 0.85, "#c3d6d9", sofaX + 0.72, 0.82, sofaZ - 0.05, 0.95);
    this.addCollider(sofaX, sofaZ, 1.85);

    // ── coffee table ──
    const tabX = 4.3;
    const tabZ = -2.3;
    this.box(1.5, 0.09, 0.9, "#8a5a33", tabX, 0.48, tabZ, 0.85);
    for (const [lx, lz] of [
      [-0.68, -0.38],
      [0.68, -0.38],
      [-0.68, 0.38],
      [0.68, 0.38],
    ] as const) {
      this.box(0.09, 0.48, 0.09, "#6e4526", tabX + lx, 0.24, tabZ + lz, 0.85);
    }
    this.addCollider(tabX, tabZ, 0.95);

    // ── desk A (left) with monitor + chair ──
    const deskAX = -6.4;
    const deskAZ = -2.4;
    this.box(2.1, 0.09, 1.0, "#7c5330", deskAX, 0.86, deskAZ, 0.8);
    for (const [lx, lz] of [
      [-0.95, -0.42],
      [0.95, -0.42],
      [-0.95, 0.42],
      [0.95, 0.42],
    ] as const) {
      this.box(0.1, 0.86, 0.1, "#5d3c20", deskAX + lx, 0.43, deskAZ + lz, 0.85);
    }
    this.box(1.15, 0.02, 0.42, "#2a2a35", deskAX - 0.05, 0.93, deskAZ, 0.6);
    // monitor
    this.box(0.02, 0.62, 0.95, "#14141c", deskAX + 0.05, 1.32, deskAZ, 0.4);
    this.box(0.86, 0.55, 0.02, "#14141c", deskAX + 0.06, 1.3, deskAZ - 0.02, 0.4);
    // screen glow
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.46),
      new THREE.MeshBasicMaterial({ color: "#7fb5ff" })
    );
    screen.position.set(deskAX + 0.07, 1.3, deskAZ - 0.04);
    screen.rotation.y = Math.PI / 2;
    this.scene.add(screen);
    // chair behind
    const chairX = deskAX + 2.0;
    const chairZ = deskAZ + 0.2;
    this.box(0.5, 0.12, 0.5, "#3d3d4d", chairX, 0.28, chairZ, 0.85);
    this.box(0.5, 0.7, 0.12, "#3d3d4d", chairX, 0.6, chairZ - 0.25, 0.85);
    this.box(0.12, 0.4, 0.5, "#3d3d4d", chairX - 0.2, 0.6, chairZ, 0.85);
    this.box(0.12, 0.4, 0.5, "#3d3d4d", chairX + 0.2, 0.6, chairZ, 0.85);
    this.addCollider(deskAX, deskAZ, 1.3);
    this.addCollider(chairX, chairZ, 0.75);

    // ── desk B (right) with monitor + chair ──
    const deskBX = 7.4;
    const deskBZ = 3.6;
    this.box(2.1, 0.09, 1.0, "#6e5a86", deskBX, 0.86, deskBZ, 0.8);
    for (const [lx, lz] of [
      [-0.95, -0.42],
      [0.95, -0.42],
      [-0.95, 0.42],
      [0.95, 0.42],
    ] as const) {
      this.box(0.1, 0.86, 0.1, "#4c3d60", deskBX + lx, 0.43, deskBZ + lz, 0.85);
    }
    this.box(1.15, 0.02, 0.42, "#2a2a35", deskBX + 0.05, 0.93, deskBZ, 0.6);
    this.box(0.02, 0.62, 0.95, "#14141c", deskBX - 0.05, 1.32, deskBZ, 0.4);
    this.box(0.86, 0.55, 0.02, "#14141c", deskBX - 0.06, 1.3, deskBZ - 0.02, 0.4);
    const screenB = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.46),
      new THREE.MeshBasicMaterial({ color: "#ffb37f" })
    );
    screenB.position.set(deskBX - 0.07, 1.3, deskBZ - 0.04);
    screenB.rotation.y = Math.PI / 2;
    this.scene.add(screenB);
    const chairBX = deskBX - 2.0;
    this.box(0.5, 0.12, 0.5, "#3d3d4d", chairBX, 0.28, deskBZ + 0.2, 0.85);
    this.box(0.5, 0.7, 0.12, "#3d3d4d", chairBX, 0.6, deskBZ - 0.05, 0.85);
    this.box(0.12, 0.4, 0.5, "#3d3d4d", chairBX - 0.2, 0.6, deskBZ + 0.2, 0.85);
    this.box(0.12, 0.4, 0.5, "#3d3d4d", chairBX + 0.2, 0.6, deskBZ + 0.2, 0.85);
    this.addCollider(deskBX, deskBZ, 1.3);
    this.addCollider(chairBX, deskBZ + 0.2, 0.75);

    // ── bookshelf (left wall) ──
    const shX = -11.2;
    const shZ = 2.0;
    this.box(0.7, 2.6, 1.6, "#7a5230", shX, 1.3, shZ, 0.85);
    this.box(0.7, 0.12, 1.6, "#8f6a44", shX, 0.62, shZ, 0.85);
    this.box(0.7, 0.12, 1.6, "#8f6a44", shX, 1.32, shZ, 0.85);
    this.box(0.7, 0.12, 1.6, "#8f6a44", shX, 2.02, shZ, 0.85);
    const bookColors = ["#c2574c", "#2f6fed", "#3fa06b", "#9a6ff0", "#f0a832", "#4a7c8a"];
    for (let shelf = 0; shelf < 3; shelf++) {
      for (let i = 0; i < 9; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, 0.34 + Math.random() * 0.2, 0.12),
          this.std(bookColors[(i + shelf) % bookColors.length], 0.9)
        );
        b.position.set(shX + 0.01, 0.8 + shelf * 0.7, shZ - 0.55 + i * 0.14);
        b.castShadow = true;
        this.scene.add(b);
      }
    }
    this.addCollider(shX, shZ, 1.0);

    // ── plants ──
    const mkPlant = (x: number, z: number, scale: number, pot: string) => {
      const g = new THREE.Group();
      const potMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.26, 0.5, 14),
        this.std(pot, 0.9)
      );
      potMesh.position.y = 0.25;
      potMesh.castShadow = true;
      g.add(potMesh);
      const foliageMat = this.std("#3e7d44", 0.9);
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
      this.addCollider(x, z, 0.55 * scale);
    };
    mkPlant(10.6, -7.2, 1.15, "#b26a4a");
    mkPlant(-10.8, 6.6, 0.95, "#8a9a5a");

    // ── floor lamp ──
    const lampX = 2.6;
    const lampZ = 5.9;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 1.9, 10),
      this.std("#3a3a46", 0.6)
    );
    pole.position.set(lampX, 0.95, lampZ);
    pole.castShadow = true;
    this.scene.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 14), this.std("#3a3a46", 0.6));
    base.position.set(lampX, 0.03, lampZ);
    this.scene.add(base);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.18, 0.34, 14, 1, true),
      this.std("#e8d7b8", 0.9)
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
    const lampLight = new THREE.PointLight(0xffc98f, 0.7, 9);
    lampLight.position.set(lampX, 1.85, lampZ);
    this.scene.add(lampLight);
    this.addCollider(lampX, lampZ, 0.4);

    // ── ceiling lights ──
    const ceilLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 14),
      new THREE.MeshBasicMaterial({ color: "#fff3d6" })
    );
    ceilLight.position.set(0, WALL_H - 0.05, 0);
    this.scene.add(ceilLight);
    const ceilLight2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 14),
      new THREE.MeshBasicMaterial({ color: "#fff3d6" })
    );
    ceilLight2.position.set(-6, WALL_H - 0.05, 2.5);
    this.scene.add(ceilLight2);

    // ── posters ──
    const mkPoster = (
      w: number,
      h: number,
      palette: [string, string, string],
      x: number,
      y: number,
      z: number,
      ry: number
    ) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03), this.std("#8a6a42", 0.8));
      frame.position.set(x, y, z);
      frame.rotation.y = ry;
      frame.castShadow = true;
      this.scene.add(frame);
      // art sits just in front of the frame, facing into the room
      const n = { x: Math.sin(ry), z: Math.cos(ry) };
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: makePosterTexture(palette) })
      );
      art.position.set(x + n.x * 0.02, y, z + n.z * 0.02);
      art.rotation.y = ry;
      this.scene.add(art);
    };
    mkPoster(1.7, 2.1, ["#2f6fed", "#7fb5ff", "#ffd166"], -4, 2.4, -HALF_D + 0.2, 0);
    mkPoster(1.4, 1.75, ["#e2574c", "#ff9d8a", "#ffe9e5"], 3.4, 2.3, HALF_D - 0.2, Math.PI);
    mkPoster(1.4, 1.75, ["#3fa06b", "#8fd6a8", "#eafff1"], HALF_W - 0.2, 2.2, 4.2, -Math.PI / 2);
    mkPoster(1.5, 1.9, ["#9a6ff0", "#c9a9ff", "#fff0b3"], -2.2, 2.35, HALF_D - 0.2, Math.PI);
  }
}
