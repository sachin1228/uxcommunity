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
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ─── Park constants ───────────────────────────────────────────────────────────
// Bella's model uses a much larger outdoor coordinate system than the old room.
let HALF_W = 48;
let HALF_D = 48;
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
  // spawn near the door, scattered so people don't start inside each other
  private px = (Math.random() * 2 - 1) * 2.5;
  private py = 0;
  private groundY = 0;
  private pz = 4.6 + Math.random() * 2;
  private playerAvatar: THREE.Object3D | null = null;
  private playerHeading = Math.PI;
  private verticalVelocity = 0;
  private grounded = true;
  private moving = false;
  private sprinting = false;
  private moveTime = 0;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();

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
    renderer.domElement.style.cursor = "grab";
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#aec972");
    this.scene.fog = new THREE.Fog("#aec972", 55, 120);

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

      // A spring-like chase camera gives the park a proper third-person feel.
      const followDistance = 8.5;
      const followHeight = 4.8;
      const pitchLift = Math.sin(this.pitch) * 3.5;
      const desiredCamera = new THREE.Vector3(
        this.px + Math.sin(this.yaw) * followDistance,
        this.py + followHeight + pitchLift,
        this.pz + Math.cos(this.yaw) * followDistance
      );
      const desiredTarget = new THREE.Vector3(this.px, this.py + EYE + 0.35, this.pz);
      const cameraEase = 1 - Math.exp(-dt * 8);
      const targetEase = 1 - Math.exp(-dt * 12);
      this.cameraPosition.lerp(desiredCamera, cameraEase);
      this.cameraTarget.lerp(desiredTarget, targetEase);
      this.camera.position.copy(this.cameraPosition);
      this.camera.lookAt(this.cameraTarget);
      this.renderer.render(this.scene, this.camera);
      this.emitFrame();
      if (this.sceneReady && !this.readyEmitted) {
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
  private sceneReady = false;

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
    if (k === " " && this.grounded && !e.repeat) {
      this.verticalVelocity = 7.5;
      this.grounded = false;
    }
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
    const speed = (sprint ? 7.2 : 4.2) * dt;
    const len = Math.hypot(f, r);
    this.moving = len > 0.01;
    this.sprinting = sprint && this.moving;
    if (this.moving) {
      const nf = f / len;
      const nr = r / len;
      const moveX = -Math.sin(this.yaw) * nf + Math.cos(this.yaw) * nr;
      const moveZ = -Math.cos(this.yaw) * nf - Math.sin(this.yaw) * nr;
      this.px += moveX * speed;
      this.pz += moveZ * speed;

      const desiredHeading = Math.atan2(moveX, moveZ);
      let turn = desiredHeading - this.playerHeading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      this.playerHeading += turn * Math.min(1, dt * 12);
      this.moveTime += dt * (sprint ? 13 : 9);
    }

    if (!this.grounded) {
      this.verticalVelocity -= 20 * dt;
      this.py += this.verticalVelocity * dt;
      if (this.py <= this.groundY) {
        this.py = this.groundY;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
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

    if (this.playerAvatar) {
      const stride = this.moving && this.grounded ? Math.sin(this.moveTime) : 0;
      const idle = this.grounded ? Math.sin(this.clock.elapsedTime * 2.2) * 0.025 : 0;
      this.playerAvatar.position.set(this.px, this.py + Math.abs(stride) * 0.045 + idle, this.pz);
      this.playerAvatar.rotation.y = this.playerHeading;
      this.playerAvatar.rotation.z = stride * (this.sprinting ? 0.025 : 0.015);
      this.playerAvatar.rotation.x = this.sprinting ? -0.08 : 0;
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
    const loader = new GLTFLoader();
    loader.load(
      "/designers/bellas-park/Portfolio.glb",
      (gltf) => {
        if (this.disposed) return;

        const park = gltf.scene;
        let spawn: THREE.Vector3 | null = null;
        let bella: THREE.Object3D | null = null;

        park.traverse((child) => {
          if (child.name === "Character") {
            spawn = child.getWorldPosition(new THREE.Vector3());
            bella = child;
          }
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
          // The source model's collider is useful to Bella's original capsule
          // controller, but should not appear in the shared room.
          if (child.name === "Ground_Collider") child.visible = false;
        });

        this.scene.add(park);

        // Keep Bella as the local player's visible avatar while preserving her
        // world transform from the source scene.
        if (bella) {
          this.scene.attach(bella);
          this.playerAvatar = bella;
        }

        const bounds = new THREE.Box3().setFromObject(park);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        if (Number.isFinite(size.x) && Number.isFinite(size.z)) {
          HALF_W = Math.max(12, size.x * 0.48);
          HALF_D = Math.max(12, size.z * 0.48);
        }

        if (spawn) {
          this.px = spawn.x;
          this.py = spawn.y;
          this.pz = spawn.z;
        } else {
          this.px = center.x;
          this.py = bounds.min.y;
          this.pz = center.z;
        }
        this.groundY = this.py;

        if (this.playerAvatar) {
          this.playerAvatar.position.set(this.px, this.py, this.pz);
          this.playerHeading = this.playerAvatar.rotation.y;
        }
        this.cameraPosition.set(this.px, this.py + 4.8, this.pz + 8.5);
        this.cameraTarget.set(this.px, this.py + EYE, this.pz);
        this.sceneReady = true;
      },
      undefined,
      () => {
        if (this.disposed) return;
        this.opts.onError("Bella Park could not be loaded. Please refresh and try again.");
      }
    );
  }

}
