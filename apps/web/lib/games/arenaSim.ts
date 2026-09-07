import {
  ARENA,
  BUILDINGS,
  BOT_KIND,
  CORE,
  PLAYER,
  WAVE_COUNT,
  type BotKind,
  type BulletWire,
  type GamePhase,
  type WorldSnapshot,
} from "./arenaTypes";
import { dist, moveWithCollisions } from "./geom";

export const SPAWNS = [
  { x: 110, y: 110 },
  { x: ARENA.w - 110, y: 110 },
  { x: 110, y: ARENA.h - 110 },
  { x: ARENA.w - 110, y: ARENA.h - 110 },
];

export interface HostPlayer {
  id: string;
  handle: string;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  hp: number;
  /** Seconds until respawn (0 when alive). */
  respawnIn: number;
  score: number;
  /** Global i-frames after taking a hit. */
  hurtCd: number;
}

export interface HostBot {
  id: number;
  kind: BotKind;
  x: number;
  y: number;
  hp: number;
  shootCd: number;
  hurtFlash: number;
}

export interface FeedEntry {
  seq: number;
  text: string;
  tone: "kill" | "info" | "warn";
}

export interface HostState {
  phase: GamePhase;
  wave: number;
  /** Seconds left in the current phase (countdown / intermission). */
  clock: number;
  coreHp: number;
  players: Record<string, HostPlayer>;
  bots: HostBot[];
  botBullets: BulletWire[];
  feed: FeedEntry[];
  seq: number;
  /** Host wall-clock ms — carried into snapshots for bullet extrapolation. */
  tMs: number;
  nextBotId: number;
  round: number;
}

const CORE_HALF = CORE.size / 2;
const CORE_CENTER = { x: ARENA.w / 2, y: ARENA.h / 2 };

export function createHostState(
  roster: Array<{ id: string; handle: string }>,
): HostState {
  const players: Record<string, HostPlayer> = {};
  roster.slice(0, 4).forEach((p, i) => {
    players[p.id] = {
      id: p.id,
      handle: p.handle,
      x: SPAWNS[i].x,
      y: SPAWNS[i].y,
      angle: Math.PI,
      alive: true,
      hp: PLAYER.maxHp,
      respawnIn: 0,
      score: 0,
      hurtCd: 0,
    };
  });
  return {
    phase: "lobby",
    wave: 0,
    clock: 0,
    coreHp: CORE.maxHp,
    players,
    bots: [],
    botBullets: [],
    feed: [],
    seq: 0,
    tMs: 0,
    nextBotId: 1,
    round: 0,
  };
}

/** Hosts >4 peers gracefully — they spectate until a slot frees at respawn. */
function ensurePlayer(state: HostState, id: string, handle: string, slot: number): void {
  if (state.players[id]) return;
  const s = SPAWNS[slot % SPAWNS.length];
  state.players[id] = {
    id,
    handle,
    x: s.x,
    y: s.y,
    angle: 0,
    alive: true,
    hp: PLAYER.maxHp,
    respawnIn: 0,
    score: 0,
    hurtCd: 0,
  };
}

/**
 * Rebuild host state from the last broadcast snapshot — used when the old
 * host drops and the earliest remaining peer takes over mid-round. Player
 * positions come from the new host's view of the world (movement broadcasts)
 * and are applied by the caller.
 */
export function adoptSnapshot(
  snap: WorldSnapshot,
  roster: Array<{ id: string; handle: string }>,
): HostState {
  const state = createHostState(roster);
  state.phase = snap.phase;
  state.wave = snap.wave;
  state.clock = snap.clock;
  state.coreHp = snap.coreHp;
  state.seq = snap.seq;
  state.feed = [];
  state.bots = snap.bots.map((b) => ({
    id: b.id,
    kind: b.kind,
    x: b.x,
    y: b.y,
    hp: b.hp,
    shootCd: 1,
    hurtFlash: 0,
  }));
  state.botBullets = snap.botBullets.map((b) => ({ ...b }));
  state.nextBotId = Math.max(1, ...state.bots.map((b) => b.id + 1));
  for (const [id, st] of Object.entries(snap.players)) {
    const p = state.players[id];
    if (!p) continue;
    p.hp = st.hp;
    p.alive = st.alive;
    p.respawnIn = st.respawnIn;
    p.score = st.score;
  }
  return state;
}

/** Hosts add players who join mid-game (spectate → play next round). */
export function addPlayer(state: HostState, id: string, handle: string): void {
  const slot = Object.keys(state.players).length;
  ensurePlayer(state, id, handle, slot);
}

function pushFeed(state: HostState, text: string, tone: FeedEntry["tone"]): void {
  state.seq += 1;
  state.feed.push({ seq: state.seq, text, tone });
  if (state.feed.length > 60) state.feed.splice(0, state.feed.length - 60);
}

function pointClearOfBuildings(x: number, y: number, r: number): boolean {
  return !BUILDINGS.some((b) => {
    const ex = CORE_CENTER.x - CORE_HALF;
    const ey = CORE_CENTER.y - CORE_HALF;
    const nearbyCore = x > ex - 120 && x < ex + CORE.size + 120 && y > ey - 120 && y < ey + CORE.size + 120;
    if (nearbyCore) return true;
    const cx = Math.max(b.x, Math.min(x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(y, b.y + b.h));
    return (cx - x) ** 2 + (cy - y) ** 2 <= (r + 6) ** 2;
  });
}

function botSpawnPoint(rnd: () => number): { x: number; y: number } {
  for (let attempt = 0; attempt < 40; attempt++) {
    const side = Math.floor(rnd() * 4);
    const t = 60 + rnd() * (Math.min(ARENA.w, ARENA.h) - 120);
    const x =
      side === 0 ? t : side === 1 ? ARENA.w - t : side === 2 ? t : rnd() * ARENA.w;
    const y =
      side === 0 ? rnd() * ARENA.h : side === 1 ? rnd() * ARENA.h : side === 2 ? 40 : ARENA.h - 40;
    if (pointClearOfBuildings(x, y, 16)) return { x, y };
  }
  // Fallback: edges of the core-adjacent clear ring.
  return { x: 60 + rnd() * 60, y: 60 + rnd() * 60 };
}

export function spawnWave(state: HostState, rnd: () => number): void {
  const playersAlive = Object.values(state.players).filter((p) => p.alive).length;
  const base = Math.max(1, playersAlive);
  const count = Math.min(14, 2 + state.wave * 2 + base + (state.wave >= 2 ? 2 : 0));
  for (let i = 0; i < count; i++) {
    const kind: BotKind = state.wave >= 2 && i % 4 === 0 ? "runner" : "grunt";
    const p = botSpawnPoint(rnd);
    state.bots.push({
      id: state.nextBotId++,
      kind,
      x: p.x,
      y: p.y,
      hp: BOT_KIND[kind].hp,
      shootCd: rnd() * 1,
      hurtFlash: 0,
    });
  }
  pushFeed(state, `Wave ${state.wave} — ${count} bots spotted`, "info");
}

export function startRound(state: HostState): void {
  state.phase = "countdown";
  state.clock = 3.2;
  state.coreHp = CORE.maxHp;
  state.wave = 0;
  state.bots = [];
  state.botBullets = [];
  state.round += 1;
  for (const p of Object.values(state.players)) {
    const slot = Object.keys(state.players).indexOf(p.id);
    const s = SPAWNS[slot % SPAWNS.length];
    p.x = s.x;
    p.y = s.y;
    p.alive = true;
    p.hp = PLAYER.maxHp;
    p.respawnIn = 0;
    p.hurtCd = 0;
    p.score = 0;
  }
  pushFeed(state, "Round started — protect the Paper Core!", "info");
}

function segmentBlockedByBuildings(x1: number, y1: number, x2: number, y2: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.ceil(len / 14);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const ex = CORE_CENTER.x - CORE_HALF;
    const ey = CORE_CENTER.y - CORE_HALF;
    const inCore = px > ex && px < ex + CORE.size && py > ey && py < ey + CORE.size;
    if (inCore) return true;
    if (BUILDINGS.some((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)) return true;
  }
  return false;
}

const BOT_BULLET_SPEED = 260;

function fireBotBullet(state: HostState, bot: HostBot, tx: number, ty: number): void {
  const a = Math.atan2(ty - bot.y, tx - bot.x);
  const kind = BOT_KIND[bot.kind];
  state.botBullets.push({
    x: bot.x + Math.cos(a) * (kind.radius + 4),
    y: bot.y + Math.sin(a) * (kind.radius + 4),
    vx: Math.cos(a) * BOT_BULLET_SPEED,
    vy: Math.sin(a) * BOT_BULLET_SPEED,
  });
}

/** Apply a shooter's validated hit on a bot (host authority). */
export function applyHit(state: HostState, shooterId: string, botId: number): boolean {
  const bot = state.bots.find((b) => b.id === botId);
  const shooter = state.players[shooterId];
  if (!bot || !shooter) return false;
  bot.hp -= 1;
  bot.hurtFlash = 0.12;
  if (bot.hp <= 0) {
    state.bots = state.bots.filter((b) => b.id !== botId);
    shooter.score += 10;
    pushFeed(state, `${shooter.handle} ✂ crumpled a bot (+10)`, "kill");
    return true;
  }
  return false;
}

/** One fixed host tick. dt is in seconds. */
export function stepHost(state: HostState, dt: number, tMs: number, rnd: () => number): void {
  state.tMs = tMs;
  const players = Object.values(state.players);

  // ── Phase machine ──────────────────────────────────────────────────
  if (state.phase === "countdown") {
    state.clock -= dt;
    if (state.clock <= 0) {
      state.phase = "wave";
      state.wave += 1;
      spawnWave(state, rnd);
    }
  } else if (state.phase === "wave") {
    const cleared = state.bots.length === 0;
    if (cleared) {
      if (state.wave >= WAVE_COUNT) {
        state.phase = "victory";
        pushFeed(state, "Victory! The Paper Core stands. ✂", "warn");
      } else {
        state.phase = "intermission";
        state.clock = 2.6;
        pushFeed(state, `Wave ${state.wave} cleared`, "info");
      }
    }
  } else if (state.phase === "intermission") {
    state.clock -= dt;
    if (state.clock <= 0) {
      state.phase = "wave";
      state.wave += 1;
      spawnWave(state, rnd);
    }
  }

  if (state.phase === "wave" || state.phase === "intermission") {
    // Bots gnaw on the core.
    const ex = CORE_CENTER.x - CORE_HALF;
    const ey = CORE_CENTER.y - CORE_HALF;
    const gnawing = state.bots.some(
      (b) => b.x > ex - 8 && b.x < ex + CORE.size + 8 && b.y > ey - 8 && b.y < ey + CORE.size + 8,
    );
    if (gnawing) state.coreHp -= CORE.dps * dt;
    if (state.coreHp <= 0) {
      state.coreHp = 0;
      state.phase = "defeat";
      pushFeed(state, "The Paper Core was shredded…", "warn");
    }
  }

  // Respawns + hurt cooldowns.
  for (const p of players) {
    if (p.hurtCd > 0) p.hurtCd -= dt;
    if (!p.alive) {
      p.respawnIn -= dt;
      if (p.respawnIn <= 0) {
        const slot = Object.keys(state.players).indexOf(p.id);
        const s = SPAWNS[slot % SPAWNS.length];
        p.x = s.x;
        p.y = s.y;
        p.alive = true;
        p.hp = PLAYER.maxHp;
        p.respawnIn = 0;
      }
    }
  }

  // ── Bots ───────────────────────────────────────────────────────────
  const walkers = state.bots;
  for (let i = 0; i < walkers.length; i++) {
    const bot = walkers[i];
    if (bot.hurtFlash > 0) bot.hurtFlash -= dt;
    const kind = BOT_KIND[bot.kind];

    // Nearest alive player target.
    let target: HostPlayer | null = null;
    let best = Infinity;
    for (const p of players) {
      if (!p.alive) continue;
      const d = dist(bot.x, bot.y, p.x, p.y);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    const tx = target?.x ?? CORE_CENTER.x;
    const ty = target?.y ?? CORE_CENTER.y;
    const toTarget = Math.atan2(ty - bot.y, tx - bot.x);

    // Slight per-bot wander so the wave doesn't march in lockstep.
    const wobble = Math.sin(tMs / 900 + bot.id * 1.7) * 0.45;
    const angle = toTarget + wobble;

    const moved = moveWithCollisions(
      bot.x,
      bot.y,
      Math.cos(angle) * kind.speed * dt,
      Math.sin(angle) * kind.speed * dt,
      kind.radius,
      BUILDINGS,
      ARENA.w,
      ARENA.h,
    );
    bot.x = moved.x;
    bot.y = moved.y;

    // Separation from other bots.
    for (let j = i + 1; j < walkers.length; j++) {
      const o = walkers[j];
      const d = dist(bot.x, bot.y, o.x, o.y);
      const min = kind.radius + BOT_KIND[o.kind].radius;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        const nx = (o.x - bot.x) / d;
        const ny = (o.y - bot.y) / d;
        bot.x -= nx * push;
        bot.y -= ny * push;
        o.x += nx * push;
        o.y += ny * push;
      }
    }

    // Contact damage on players.
    if (target) {
      const reach = kind.radius + PLAYER.radius + 2;
      if (dist(bot.x, bot.y, target.x, target.y) < reach) {
        if (target.hurtCd <= 0 && target.alive) {
          hurtPlayer(state, target, 1);
        }
      }
    }

    // Ranged attacks.
    bot.shootCd -= dt;
    if (bot.shootCd <= 0 && target && target.alive && best < kind.shootRange) {
      if (!segmentBlockedByBuildings(bot.x, bot.y, target.x, target.y)) {
        fireBotBullet(state, bot, target.x, target.y);
      }
      bot.shootCd = kind.shootEveryMs / 1000;
    }
  }

  // ── Bot bullets ────────────────────────────────────────────────────
  const nextBullets: BulletWire[] = [];
  for (const b of state.botBullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let dead =
      b.x < 0 || b.x > ARENA.w || b.y < 0 || b.y > ARENA.h ||
      BUILDINGS.some((r) => b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h);
    if (!dead) {
      for (const p of players) {
        if (!p.alive || p.hurtCd > 0) continue;
        if (dist(b.x, b.y, p.x, p.y) < PLAYER.radius + 3) {
          hurtPlayer(state, p, 1);
          dead = true;
          break;
        }
      }
    }
    if (!dead) nextBullets.push(b);
  }
  state.botBullets = nextBullets;
}

function hurtPlayer(state: HostState, p: HostPlayer, amount: number): void {
  p.hurtCd = 0.9;
  p.hp -= amount;
  if (p.hp <= 0) {
    p.alive = false;
    p.hp = 0;
    p.respawnIn = PLAYER.respawnMs / 1000;
    pushFeed(state, `${p.handle} was crumpled — respawning…`, "warn");
  }
}

/** Position updates for remote players (host receives them via broadcast). */
export function applyRemoteMove(
  state: HostState,
  id: string,
  x: number,
  y: number,
  angle: number,
): void {
  const p = state.players[id];
  if (!p || !p.alive) return;
  p.x = x;
  p.y = y;
  p.angle = angle;
}

/** Kill-feed + snapshot serialisation for broadcast. */
export function snapshotFrom(
  state: HostState,
  sinceSeq: number,
): WorldSnapshot {
  const players: WorldSnapshot["players"] = {};
  for (const [id, p] of Object.entries(state.players)) {
    players[id] = {
      hp: p.hp,
      alive: p.alive,
      respawnIn: Math.max(0, p.respawnIn),
      score: p.score,
    };
  }
  const feed = state.feed.filter((f) => f.seq > sinceSeq);
  return {
    seq: state.seq,
    phase: state.phase,
    wave: state.wave,
    clock: Math.max(0, state.clock),
    coreHp: Math.max(0, Math.ceil(state.coreHp)),
    players,
    bots: state.bots.map((b) => ({
      id: b.id,
      kind: b.kind,
      x: b.x,
      y: b.y,
      vx: 0,
      vy: 0,
      hp: b.hp,
      flash: b.hurtFlash > 0 ? 1 : 0,
    })),
    botBullets: state.botBullets.map((b) => ({ ...b })),
    scores: Object.fromEntries(Object.values(state.players).map((p) => [p.id, p.score])),
    feed,
    t: state.tMs,
  };
}
