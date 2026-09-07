/** Shared arena constants + wire types for the Paper Bots multiplayer game. */

export const ARENA = {
  w: 1500,
  h: 940,
};

export const PLAYER = {
  radius: 15,
  speed: 250,
  maxHp: 6,
  respawnMs: 3000,
};

export const CORE = {
  size: 78, // square (world units)
  maxHp: 60,
  /** Damage per second a bot standing on the core deals. */
  dps: 6,
};

export const WAVE_COUNT = 5;

/** World rectangles that block movement & bullets — drawn as paper buildings. */
export interface BuildingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BUILDINGS: BuildingRect[] = [
  // Corner city blocks (kept away from the centre core + spawn corners).
  { x: 170, y: 150, w: 170, h: 120 },
  { x: 1500 - 340, y: 150, w: 170, h: 120 },
  { x: 170, y: 940 - 270, w: 170, h: 120 },
  { x: 1500 - 340, y: 940 - 270, w: 170, h: 120 },
  // Mid-board blocks that create lanes toward the core.
  { x: 620, y: 90, w: 130, h: 110 },
  { x: 1500 - 750, y: 940 - 200, w: 130, h: 110 },
  { x: 300, y: 460, w: 150, h: 90 },
  { x: 1500 - 450, y: 460, w: 150, h: 90 },
];

/** Colored pencil palette used to tell players apart. */
export const PENCILS = [
  "#2f5fd0", // blue
  "#d64545", // red
  "#c27c1c", // amber
  "#1f9d61", // green
  "#8b4fc9", // purple
  "#e0489a", // pink
];

export const BOT_KIND = {
  grunt: { radius: 15, hp: 3, speed: 86, shootEveryMs: 1500, shootRange: 460 },
  runner: { radius: 11, hp: 2, speed: 148, shootEveryMs: 2200, shootRange: 340 },
} as const;

export type BotKind = keyof typeof BOT_KIND;

export type GamePhase =
  | "lobby"
  | "countdown"
  | "wave"
  | "intermission"
  | "victory"
  | "defeat";

export interface PlayerStatus {
  hp: number;
  alive: boolean;
  respawnIn: number; // seconds, 0 when alive
  score: number;
}

export interface BotWire {
  id: number;
  kind: BotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** 1 while the bot was just hit (white flash). */
  flash?: number;
}

export interface BulletWire {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FeedItem {
  /** Monotonic id used to dedupe across incremental snapshots. */
  seq: number;
  text: string;
  tone: "kill" | "info" | "warn";
}

/** Incremental world snapshot broadcast by the host. */
export interface WorldSnapshot {
  seq: number;
  phase: GamePhase;
  wave: number;
  /** Remaining seconds for countdown / intermission / waves. */
  clock: number;
  coreHp: number;
  players: Record<string, PlayerStatus>;
  bots: BotWire[];
  botBullets: BulletWire[];
  /** Kills credited per player id. */
  scores: Record<string, number>;
  /** Only feed items newer than the previous snapshot. */
  feed: FeedItem[];
  t: number; // host time (ms)
}

/** Where a single player is right now (client-authoritative movement). */
export interface PlayerMoveWire {
  x: number;
  y: number;
  angle: number;
  moving: boolean;
}

/** One player bullet fired (client-authoritative trajectory + host-validated hit). */
export interface ShotWire {
  x: number;
  y: number;
  angle: number;
  bulletId: number;
}

/** Host-validated hit claim from a shooter. */
export interface HitClaimWire {
  bulletId: number;
  botId: number;
}

export const SNAPSHOT_HZ = 12;
export const MOVE_HZ = 15;
