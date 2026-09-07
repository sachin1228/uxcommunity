"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Gamepad2, Home, LogOut, Play, RotateCcw } from "lucide-react";
import {
  ARENA,
  BUILDINGS,
  CORE,
  PLAYER,
  WAVE_COUNT,
  PENCILS,
  type BotWire,
  type GamePhase,
  type PlayerMoveWire,
  type PlayerStatus,
  type WorldSnapshot,
} from "@/lib/games/arenaTypes";
import {
  addPlayer,
  adoptSnapshot,
  applyHit,
  applyRemoteMove,
  createHostState,
  snapshotFrom,
  startRound,
  stepHost,
  type HostState,
} from "@/lib/games/arenaSim";
import { bulletHitsRect, dist, moveWithCollisions } from "@/lib/games/geom";
import { pickHost, type PaperRoom, type PeerMeta } from "@/lib/games/paperRoom";
import { drawFrame, type ViewFrame, type ViewPlayer } from "./arenaDraw";

export interface ArenaIdentity {
  id: string;
  handle: string;
  avatar: string | null;
}

const BULLET_SPEED = 640;
const BULLET_LIFE = 0.85;
const FIRE_INTERVAL = 0.19;
const SNAP_INTERVAL = 1 / 12;
const MOVE_INTERVAL = 1 / 15;

interface ArenaProps {
  me: ArenaIdentity;
  room: PaperRoom | null;
  code: string;
  connecting?: boolean;
  onExit: () => void;
}

interface BulletLocal {
  x: number;
  y: number;
  angle: number;
  age: number;
  ownerId: string;
  color: string;
}

interface FeedRow {
  id: number;
  text: string;
  tone: "kill" | "info" | "warn";
}

interface RemoteTarget extends PlayerMoveWire {
  handle: string;
}

export function PaperArena({ me, room, code, onExit }: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cssSize, setCssSize] = useState({ w: 900, h: 560 });

  const [peers, setPeers] = useState<PeerMeta[]>(room ? room.roster() : []);
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [clock, setClock] = useState(0);
  const [wave, setWave] = useState(0);
  const [coreHp, setCoreHp] = useState(CORE.maxHp);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<Record<string, PlayerStatus>>({});
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState(false);

  // Refs used by the hot loop.
  const roomRef = useRef(room);
  roomRef.current = room;
  const hostRef = useRef<HostState | null>(null);
  const snapRef = useRef<{ snap: WorldSnapshot; recvAt: number } | null>(null);
  const mePosRef = useRef({ x: 90, y: 90, angle: Math.PI * 1.25 });
  const remoteRef = useRef<Record<string, RemoteTarget>>({});
  const smoothRef = useRef<Record<string, { x: number; y: number }>>({});
  const bulletsRef = useRef<BulletLocal[]>([]);
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseRef = useRef({ x: 0, y: 0, down: false, inside: false, started: false });
  const lastFireRef = useRef(0);
  const lastMoveSendRef = useRef(0);
  const lastSnapSendRef = useRef(0);
  const lastUiPushRef = useRef(0);
  const feedSeqRef = useRef(0);
  const bulletSeqRef = useRef(1);
  const lastSentSeqRef = useRef(0);

  // Role.
  const [isHost, setIsHost] = useState<boolean>(() => (room ? pickHost(room.roster()) === me.id : true));
  const isHostRef = useRef(isHost);
  const phaseRef = useRef<GamePhase>("lobby");
  const aliveStateRef = useRef({ alive: true, wasAlive: true });

  // ── Derived helpers (stable) ─────────────────────────────────────────
  const sortedPeers = useCallback((): PeerMeta[] => {
    const list = roomRef.current ? [...roomRef.current.roster()] : [];
    if (!list.some((p) => p.id === me.id)) {
      list.unshift({ id: me.id, handle: me.handle, avatar: me.avatar, joinedAt: 0 });
    }
    return list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  }, [me]);

  const colorOf = useCallback((id: string) => {
    const idx = sortedPeers().findIndex((p) => p.id === id);
    return PENCILS[(idx < 0 ? 0 : idx) % PENCILS.length];
  }, [sortedPeers]);

  const seatOf = useCallback((id: string) => Math.max(0, sortedPeers().findIndex((p) => p.id === id)), [sortedPeers]);

  const spawnFor = useCallback((seat: number) => {
    const s = seat % 4;
    return { x: [90, ARENA.w - 90, 90, ARENA.w - 90][s], y: [90, 90, ARENA.h - 90, ARENA.h - 90][s] };
  }, []);

  const handleRoster = useCallback(
    (list: PeerMeta[]) => {
      setPeers(list);
      const hostId = pickHost(list);
      const amHost = hostId === me.id;
      isHostRef.current = amHost;
      setIsHost(amHost);

      if (amHost && !hostRef.current) {
        // Take over: adopt the last broadcast snapshot if there is one.
        const snap = snapRef.current;
        if (snap && snap.snap.phase !== "lobby") {
          hostRef.current = adoptSnapshot(snap.snap, list);
          const h = hostRef.current;
          // Restore everyone's positions from our view of the world.
          const self = h.players[me.id];
          if (self && self.alive) {
            self.x = mePosRef.current.x;
            self.y = mePosRef.current.y;
            self.angle = mePosRef.current.angle;
          }
          for (const [id, target] of Object.entries(remoteRef.current)) {
            if (id !== me.id && h.players[id]) applyRemoteMove(h, id, target.x, target.y, target.angle);
          }
        } else {
          hostRef.current = createHostState(list);
        }
      } else if (amHost && hostRef.current) {
        for (const p of list) {
          if (!hostRef.current.players[p.id]) addPlayer(hostRef.current, p.id, p.handle);
        }
      }
    },
    [me.id, mePosRef],
  );

  // ── Join + subscribe handlers ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!room) {
      // Solo mode: we are the host immediately.
      isHostRef.current = true;
      hostRef.current = createHostState([me]);
      return;
    }
    room.setHandlers({
      onRoster: (list) => handleRoster(list),
      onMove: (from, p) => {
        if (from === me.id) return;
        const prev = remoteRef.current[from];
        remoteRef.current[from] = { ...p, handle: prev?.handle ?? from.slice(0, 6) };
        if (isHostRef.current && hostRef.current) applyRemoteMove(hostRef.current, from, p.x, p.y, p.angle);
      },
      onShot: (from, p) => {
        if (from === me.id) return;
        bulletsRef.current.push({ x: p.x, y: p.y, angle: p.angle, age: 0, ownerId: from, color: colorOf(from) });
      },
      onHitClaim: (from, p) => {
        if (isHostRef.current && hostRef.current) applyHit(hostRef.current, from, p.botId);
      },
      onSnapshot: (payload) => {
        snapRef.current = { snap: payload as WorldSnapshot, recvAt: performance.now() };
      },
      onCommand: () => {},
    });
    void room.join().then((ok) => {
      if (!cancelled) {
        setConnectError(!ok);
        if (ok) handleRoster(room.roster());
      }
    });
    return () => {
      cancelled = true;
      room.setHandlers({});
    };
  }, [room, me, handleRoster, colorOf]);

  // ── UI sync pump: surface host / snapshot state into React at ~6 Hz ──
  useEffect(() => {
    const id = window.setInterval(() => {
      const host = hostRef.current;
      if (host) {
        phaseRef.current = host.phase;
        setPhase(host.phase);
        setClock(host.clock);
        setWave(host.wave);
        setCoreHp(Math.ceil(host.coreHp));
        const sc: Record<string, number> = {};
        const st: Record<string, PlayerStatus> = {};
        for (const p of Object.values(host.players)) {
          sc[p.id] = p.score;
          st[p.id] = { hp: p.hp, alive: p.alive, respawnIn: p.respawnIn, score: p.score };
        }
        setScores(sc);
        setStatuses(st);
        const fresh = host.feed.filter((f) => f.seq > feedSeqRef.current);
        if (fresh.length) {
          feedSeqRef.current = Math.max(feedSeqRef.current, ...fresh.map((f) => f.seq));
          setFeed((prev) => [...prev.slice(-30), ...fresh.map((f) => ({ id: f.seq, text: f.text, tone: f.tone }))]);
        }
      } else if (room && snapRef.current) {
        const snap = snapRef.current.snap;
        phaseRef.current = snap.phase;
        setPhase(snap.phase);
        setClock(snap.clock);
        setWave(snap.wave);
        setCoreHp(snap.coreHp);
        setScores(snap.scores);
        setStatuses(snap.players);
        const fresh = snap.feed.filter((f) => f.seq > feedSeqRef.current);
        if (fresh.length) {
          feedSeqRef.current = Math.max(feedSeqRef.current, ...fresh.map((f) => f.seq));
          setFeed((prev) => [...prev.slice(-30), ...fresh.map((f) => ({ id: f.seq, text: f.text, tone: f.tone }))]);
        }
      }
    }, 160);
    return () => window.clearInterval(id);
  }, [room]);

  // ── Canvas sizing ────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 10 && r.height > 10) setCssSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Keyboard / pointer ───────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      keysRef.current[e.key.toLowerCase()] = true;
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const pointerToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const pad = 26;
    const scale = Math.max(0.05, Math.min((rect.width - pad * 2) / ARENA.w, (rect.height - pad * 2) / ARENA.h));
    const ox = (rect.width - ARENA.w * scale) / 2;
    const oy = (rect.height - ARENA.h * scale) / 2;
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────
  const startRoundAction = useCallback(() => {
    if (!isHostRef.current) return;
    if (!hostRef.current) hostRef.current = createHostState(sortedPeers());
    startRound(hostRef.current);
    room?.sendCommand({ cmd: "start" });
    // Solo: no room, phase updates come from the loop.
  }, [room, sortedPeers]);

  const leaveAction = useCallback(() => {
    onExit();
  }, [onExit]);

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/games?room=${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* noop */
    }
  }, [code]);

  // ── Main loop ────────────────────────────────────────────────────────
  // Driven by setInterval (not rAF) so the sim still steps when a browser
  // throttles requestAnimationFrame (hidden/embedded tabs, preview panes).
  const loopRun = useRef(false);
  useEffect(() => {
    if (loopRun.current) return;
    loopRun.current = true;
    let last = performance.now();
    const rnd = () => Math.random();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const room = roomRef.current;

      // ── Self status: host from hostRef, guest from latest snapshot ──
      const host = hostRef.current;
      const snap = snapRef.current;
      let meAlive = true;
      if (room) {
        const status = host?.players[me.id] ?? snap?.snap.players[me.id];
        if (status) meAlive = status.alive;
      }
      const lastWasAlive = aliveStateRef.current.wasAlive;
      if (meAlive && !lastWasAlive) {
        const spawn = spawnFor(seatOf(me.id));
        mePosRef.current = { x: spawn.x, y: spawn.y, angle: Math.atan2(ARENA.h / 2 - spawn.y, ARENA.w / 2 - spawn.x) };
        if (host?.players[me.id]) {
          host.players[me.id].x = spawn.x;
          host.players[me.id].y = spawn.y;
        }
      }
      aliveStateRef.current = { alive: meAlive, wasAlive: meAlive };
      const phaseNow = host?.phase ?? snap?.snap.phase ?? "lobby";
      phaseRef.current = phaseNow;

      // ── Local player: move + fire (disabled when dead/lobby) ──
      const interactive = meAlive && phaseNow !== "lobby" && phaseNow !== "victory" && phaseNow !== "defeat";
      if (interactive) {
        const k = keysRef.current;
        let ix = 0;
        let iy = 0;
        if (k["w"] || k["arrowup"]) iy -= 1;
        if (k["s"] || k["arrowdown"]) iy += 1;
        if (k["a"] || k["arrowleft"]) ix -= 1;
        if (k["d"] || k["arrowright"]) ix += 1;
        const len = Math.hypot(ix, iy);
        const moving = len > 0;
        if (moving) {
          const pos = moveWithCollisions(
            mePosRef.current.x,
            mePosRef.current.y,
            (ix / len) * PLAYER.speed * dt,
            (iy / len) * PLAYER.speed * dt,
            PLAYER.radius,
            BUILDINGS,
            ARENA.w,
            ARENA.h,
          );
          mePosRef.current.x = pos.x;
          mePosRef.current.y = pos.y;
        }
        if (mouseRef.current.inside) {
          mePosRef.current.angle = Math.atan2(
            mouseRef.current.y - mePosRef.current.y,
            mouseRef.current.x - mePosRef.current.x,
          );
        }
        if (mouseRef.current.down && phaseNow === "wave" && now / 1000 - lastFireRef.current >= FIRE_INTERVAL) {
          lastFireRef.current = now / 1000;
          const a = mePosRef.current.angle;
          bulletsRef.current.push({
            x: mePosRef.current.x + Math.cos(a) * (PLAYER.radius + 6),
            y: mePosRef.current.y + Math.sin(a) * (PLAYER.radius + 6),
            angle: a,
            age: 0,
            ownerId: me.id,
            color: colorOf(me.id),
          });
          room?.sendShot({ x: Math.round(mePosRef.current.x), y: Math.round(mePosRef.current.y), angle: a, bulletId: bulletSeqRef.current++ });
        }
        if (room && now / 1000 - lastMoveSendRef.current >= MOVE_INTERVAL) {
          lastMoveSendRef.current = now / 1000;
          room.sendMove({
            x: Math.round(mePosRef.current.x),
            y: Math.round(mePosRef.current.y),
            angle: mePosRef.current.angle,
            moving,
          });
        }
      }

      // ── Host: simulate world ──
      if (host) {
        const self = host.players[me.id];
        if (!self) addPlayer(host, me.id, me.handle);
        else if (self.alive) {
          self.x = mePosRef.current.x;
          self.y = mePosRef.current.y;
          self.angle = mePosRef.current.angle;
        }
        stepHost(host, dt, now, rnd);

        // Keep our own position in sync with host authority.
        const s2 = host.players[me.id];
        if (s2) {
          meAlive = s2.alive;
          aliveStateRef.current = { alive: meAlive, wasAlive: meAlive };
          if (s2.alive) {
            mePosRef.current.x = s2.x;
            mePosRef.current.y = s2.y;
            mePosRef.current.angle = s2.angle;
          }
        }
        // Broadcast snapshots while a round is running.
        if (room && host.phase !== "lobby" && now / 1000 - lastSnapSendRef.current >= SNAP_INTERVAL) {
          lastSnapSendRef.current = now / 1000;
          const snapOut = snapshotFrom(host, lastSentSeqRef.current);
          lastSentSeqRef.current = snapOut.seq;
          room.sendSnapshot(snapOut);
        }
      }

      // ── Bots available for rendering/hits ──
      const worldBots: BotWire[] = host
        ? host.bots.map((b) => ({
            id: b.id,
            kind: b.kind,
            x: b.x,
            y: b.y,
            vx: 0,
            vy: 0,
            hp: b.hp,
            flash: b.hurtFlash > 0 ? 1 : 0,
          }))
        : snap
          ? snap.snap.bots.map((b) => ({
              ...b,
              // Minor lead so fast bots don't render behind their real spot.
              x: b.x + (b.vx || 0) * 0,
              y: b.y + (b.vy || 0) * 0,
            }))
          : [];

      // ── Local bullets: advance, collide, claim hits ──
      const kept: BulletLocal[] = [];
      for (const b of bulletsRef.current) {
        b.age += dt;
        if (b.age >= BULLET_LIFE) continue;
        const nx = b.x + Math.cos(b.angle) * BULLET_SPEED * dt;
        const ny = b.y + Math.sin(b.angle) * BULLET_SPEED * dt;
        const off =
          nx < 0 || nx > ARENA.w || ny < 0 || ny > ARENA.h ||
          BUILDINGS.some((r) => bulletHitsRect(nx, ny, r));
        if (off) continue;
        let hit = false;
        for (const bot of worldBots) {
          if (bot.hp <= 0) continue;
          const r = bot.kind === "runner" ? 11 : 15;
          if (dist(nx, ny, bot.x, bot.y) < r + 4) {
            hit = true;
            if (b.ownerId === me.id) {
              if (host) applyHit(host, me.id, bot.id);
              else room?.sendHitClaim({ bulletId: bot.id, botId: bot.id });
            }
            break;
          }
        }
        if (hit) continue;
        b.x = nx;
        b.y = ny;
        kept.push(b);
      }
      bulletsRef.current = kept;

      // ── Remote players: ease toward their latest reported position ──
      const smooth = smoothRef.current;
      for (const [id, target] of Object.entries(remoteRef.current)) {
        const cur = smooth[id] ?? { x: target.x, y: target.y };
        const k = Math.min(1, dt * 14);
        smooth[id] = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k };
      }
      // Forget peers that left.
      const rosterIds = new Set<string>(room ? room.roster().map((p) => p.id) : []);
      for (const id of Object.keys(smooth)) if (!rosterIds.has(id) && id !== me.id) delete smooth[id];

      // ── Assemble view ──
      const viewPlayers: Record<string, ViewPlayer> = {};
      const roster = room ? room.roster() : [me];
      const allIds = new Set<string>([me.id, ...roster.map((p) => p.id)]);
      const statusFor = (id: string): PlayerStatus | undefined =>
        host?.players[id]
          ? { hp: host.players[id].hp, alive: host.players[id].alive, respawnIn: host.players[id].respawnIn, score: host.players[id].score }
          : snap?.snap.players[id];

      for (const pid of allIds) {
        const status = statusFor(pid);
        if (pid === me.id) {
          viewPlayers[pid] = {
            id: pid,
            handle: me.handle,
            x: mePosRef.current.x,
            y: mePosRef.current.y,
            angle: mePosRef.current.angle,
            color: colorOf(pid),
            alive: status ? status.alive : true,
            hp: status?.hp ?? PLAYER.maxHp,
            self: true,
          };
        } else {
          const target = remoteRef.current[pid];
          const sm = smooth[pid] ?? { x: 100, y: 100 };
          const meta = roster.find((p) => p.id === pid);
          if (!meta && !target) continue;
          viewPlayers[pid] = {
            id: pid,
            handle: meta?.handle ?? target?.handle ?? pid.slice(0, 6),
            x: sm.x,
            y: sm.y,
            angle: target?.angle ?? 0,
            color: colorOf(pid),
            alive: status ? status.alive : true,
            hp: status?.hp ?? PLAYER.maxHp,
            self: false,
          };
        }
      }

      const bullets = bulletsRef.current.map((b) => ({
        x1: b.x - Math.cos(b.angle) * 15,
        y1: b.y - Math.sin(b.angle) * 15,
        x2: b.x,
        y2: b.y,
        color: b.color,
      }));

      // Extrapolate host bot-bullets a touch so they stay smooth at 12 Hz.
      const ageSec = snap ? (now - snap.recvAt) / 1000 : 0;
      const botBullets = host
        ? host.botBullets.map((b) => ({ ...b }))
        : snap
          ? snap.snap.botBullets.map((b) => ({ x: b.x + b.vx * ageSec, y: b.y + b.vy * ageSec, vx: b.vx, vy: b.vy }))
          : [];

      const frame: ViewFrame = {
        players: viewPlayers,
        bots: worldBots,
        botBullets,
        bullets,
        coreHp: host ? Math.ceil(host.coreHp) : (snap?.snap.coreHp ?? CORE.maxHp),
        tMs: now,
      };

      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const ctx = canvas.getContext("2d");
        if (ctx && rect.width > 4) drawFrame(ctx, rect.width, rect.height, frame, now);
      }

      // Rare UI flushes outside the interval (phase transitions).
      if (now - lastUiPushRef.current > 1200) {
        lastUiPushRef.current = now;
        if (host && host.phase !== phaseRef.current) {
          phaseRef.current = host.phase;
          setPhase(host.phase);
        }
      }
    };
    const handle = window.setInterval(tick, 16);
    tick();
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const banner = useMemo(() => {
    if (phase === "countdown") return { title: "Get ready…", sub: `Round starts in ${Math.max(0, clock).toFixed(1)}s` };
    if (phase === "wave") return { title: `Wave ${wave}`, sub: wave >= WAVE_COUNT ? "Final wave — hold the line!" : `${WAVE_COUNT - wave} waves to go` };
    if (phase === "intermission") return { title: "Breathe.", sub: `Next wave in ${Math.max(0, clock).toFixed(1)}s` };
    if (phase === "victory") return { title: "Victory!", sub: "Every bot shredded. The Paper Core stands." };
    if (phase === "defeat") return { title: "Shredded!", sub: "The bots tore through the Paper Core…" };
    return { title: "", sub: "" };
  }, [phase, clock, wave]);

  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const isSolo = !room;
  const inLobby = phase === "lobby";
  const over = phase === "victory" || phase === "defeat";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* ── Top bar ── */}
      <div className="relative z-10 flex h-11 shrink-0 items-center gap-2 border-b-2 border-[var(--paper-ink)] bg-[var(--paper)] px-3">
        <Gamepad2 size={16} className="text-[var(--paper-ink)]" />
        <span className="font-display text-xs font-bold uppercase tracking-widest text-[var(--paper-ink)]">Paper Bots</span>
        <span className="hidden rounded-sm border border-dashed border-[var(--paper-ink)] px-1.5 py-px font-body text-[10px] font-semibold uppercase tracking-wider text-[var(--paper-muted)] sm:inline">
          {isSolo ? "solo sketch" : isHost ? "host" : "player"} · {code}
        </span>

        <div className="ml-2 hidden items-center gap-1.5 md:flex">
          <span className="font-body text-[10px] font-bold uppercase tracking-wide text-[var(--paper-ink)]">Core</span>
          <div className="h-2.5 w-24 overflow-hidden rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-deep)]">
            <div className="h-full bg-[var(--paper-red)] transition-all duration-300" style={{ width: `${Math.max(0, (coreHp / CORE.maxHp) * 100)}%` }} />
          </div>
        </div>

        {!inLobby && (
          <span className="rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] px-2 py-0.5 font-body text-[11px] font-bold text-[var(--paper-ink)] shadow-[2px_2px_0_var(--paper-ink)]">
            {banner.title}
          </span>
        )}

        <div className="flex-1" />

        {room && (
          <button type="button" onClick={() => void copyInvite()} className="flex h-7 items-center gap-1 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] px-2 font-body text-[10px] font-semibold text-[var(--paper-ink)] transition-transform hover:-translate-y-px active:translate-y-0" aria-label="Copy invite link">
            {copied ? "Copied!" : <><Copy size={12} /> Invite</>}
          </button>
        )}
        <button type="button" onClick={leaveAction} className="flex h-7 items-center gap-1 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] px-2 font-body text-[10px] font-semibold text-[var(--paper-ink)] transition-transform hover:-translate-y-px active:translate-y-0">
          <LogOut size={12} /> Leave
        </button>
      </div>

      {/* ── Canvas area ── */}
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          onPointerMove={(e) => {
            const w = pointerToWorld(e.clientX, e.clientY);
            mouseRef.current.x = w.x;
            mouseRef.current.y = w.y;
            mouseRef.current.inside = true;
            mouseRef.current.started = true;
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            const w = pointerToWorld(e.clientX, e.clientY);
            mouseRef.current.x = w.x;
            mouseRef.current.y = w.y;
            mouseRef.current.down = true;
            mouseRef.current.inside = true;
            (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={() => {
            mouseRef.current.down = false;
          }}
          onPointerLeave={() => {
            mouseRef.current.down = false;
          }}
          className="h-full w-full cursor-none touch-none select-none"
          style={{ width: cssSize.w, height: cssSize.h }}
        />

        {/* Center banner for transitions */}
        {(phase === "countdown" || phase === "intermission") && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rotate-[-1.5deg] rounded-md border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] px-6 py-3 text-center shadow-[4px_4px_0_var(--paper-ink)]">
              <p className="font-display text-lg font-bold uppercase tracking-wide text-[var(--paper-ink)]">{banner.title}</p>
              <p className="mt-0.5 font-body text-xs text-[var(--paper-muted)]">{banner.sub}</p>
            </div>
          </div>
        )}

        {/* Help chip */}
        {!inLobby && !over && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded-sm border border-dashed border-[var(--paper-ink)] bg-[var(--paper)]/90 px-2 py-1 font-body text-[10px] text-[var(--paper-ink)]">
            WASD to move · mouse to aim · hold click to shoot
          </div>
        )}

        {/* Feed */}
        {feed.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 flex w-60 flex-col items-start gap-0.5">
            {feed.slice(-3).map((f) => (
              <div
                key={f.id}
                className={`max-w-full truncate rounded-sm border border-dashed px-1.5 py-0.5 font-body text-[10px] ${
                  f.tone === "kill"
                    ? "border-[var(--paper-ink)] bg-[var(--paper-card)]/90 text-[var(--paper-ink)]"
                    : f.tone === "warn"
                      ? "border-[var(--paper-red)] bg-[#fbeaea]/90 text-[var(--paper-red)]"
                      : "border-[var(--paper-line)] bg-[var(--paper)]/85 text-[var(--paper-muted)]"
                }`}
              >
                {f.text}
              </div>
            ))}
          </div>
        )}

        {/* Scoreboard */}
        {!inLobby && sortedScores.length > 0 && (
          <div className="absolute right-2 top-2 w-40 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-card)]/95 p-2 shadow-[3px_3px_0_var(--paper-ink)]">
            <p className="mb-1.5 border-b border-dashed border-[var(--paper-line)] pb-1 font-body text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--paper-muted)]">Scoreboard</p>
            <div className="space-y-1">
              {sortedScores.slice(0, 6).map(([id, score], i) => (
                <div key={id} className="flex items-center gap-1.5">
                  <span className="w-3 font-body text-[10px] text-[var(--paper-muted)]">{i + 1}</span>
                  <span className="h-2.5 w-2.5 rounded-full border border-[var(--paper-ink)]" style={{ background: colorOf(id) }} />
                  <span className="truncate font-body text-[10px] font-semibold text-[var(--paper-ink)]">
                    {id === me.id ? `${me.handle} (you)` : peers.find((p) => p.id === id)?.handle ?? "?"}
                  </span>
                  {!statuses[id]?.alive && statuses[id] && <span className="text-[var(--paper-red)]">✕</span>}
                  <span className="ml-auto font-body text-[10px] font-bold text-[var(--paper-ink)]">{score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Lobby overlay ── */}
      {inLobby && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[var(--paper)]/90 p-4">
          <div className="my-auto w-[min(24rem,92vw)] rounded-lg border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] p-5 shadow-[5px_5px_0_var(--paper-ink)]">
            <p className="font-body text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--paper-red)]">Multiplayer sketchpad</p>
            <h2 className="mt-0.5 font-display text-2xl font-bold uppercase tracking-wide text-[var(--paper-ink)]">Paper Bots</h2>
            <p className="mt-1 font-body text-xs text-[var(--paper-muted)]">
              A co-op paper arena — shred wave after wave of sketchy bots before they eat the core.
            </p>

            <div className="mt-4 flex items-center justify-between rounded-sm border-2 border-dashed border-[var(--paper-ink)] px-3 py-2">
              <div>
                <p className="font-body text-[9px] font-bold uppercase tracking-widest text-[var(--paper-muted)]">Room code</p>
                <p className="font-display text-xl font-bold tracking-[0.3em] text-[var(--paper-ink)]">{code}</p>
              </div>
              {room ? (
                <button type="button" onClick={() => void copyInvite()} className="flex items-center gap-1 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper)] px-2.5 py-1.5 font-body text-[11px] font-bold text-[var(--paper-ink)] transition-transform hover:-translate-y-px active:translate-y-0">
                  {copied ? "Copied!" : <><Copy size={13} /> Copy link</>}
                </button>
              ) : (
                <span className="font-body text-[10px] font-bold uppercase text-[var(--paper-red)]">solo</span>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-1.5 font-body text-[9px] font-bold uppercase tracking-widest text-[var(--paper-muted)]">
                {isSolo ? "Your bench" : `${peers.length} player${peers.length === 1 ? "" : "s"} on the bench`}
              </p>
              <div className="flex flex-col gap-1">
                {(isSolo ? [me] : peers).map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-sm border border-[var(--paper-line)] bg-[var(--paper)] px-2 py-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[var(--paper-ink)] font-body text-[9px] font-bold" style={{ background: colorOf(p.id) === PENCILS[0] ? "#fff" : colorOf(p.id) }}>
                      {p.handle.charAt(0).toUpperCase()}
                    </span>
                    <span className="font-body text-xs font-semibold text-[var(--paper-ink)]">
                      {p.handle}
                      {p.id === me.id && <span className="text-[var(--paper-muted)]"> (you)</span>}
                    </span>
                    {pickHost(isSolo ? [] : peers) === p.id && !isSolo && (
                      <span className="ml-auto rounded-sm border border-dashed border-[var(--paper-ink)] px-1.5 font-body text-[9px] font-bold uppercase text-[var(--paper-muted)]">host</span>
                    )}
                    {p.id === me.id && isSolo && (
                      <span className="ml-auto rounded-sm border border-dashed border-[var(--paper-ink)] px-1.5 font-body text-[9px] font-bold uppercase text-[var(--paper-muted)]">host</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {connectError && (
              <p className="mt-3 rounded-sm border border-[var(--paper-red)] bg-[#fbeaea] px-2 py-1.5 font-body text-[11px] text-[var(--paper-red)]">
                Couldn&apos;t reach the realtime room — you can still sketch solo.
              </p>
            )}

            {isHost ? (
              <button
                type="button"
                onClick={startRoundAction}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-ink)] px-4 py-2.5 font-body text-sm font-bold text-[var(--paper)] shadow-[3px_3px_0_var(--paper-red)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <Play size={15} /> Start round
              </button>
            ) : (
              <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-sm border-2 border-dashed border-[var(--paper-ink)] bg-[var(--paper)] px-4 py-2.5 font-body text-xs font-bold text-[var(--paper-muted)]">
                Waiting for the host to start…
              </div>
            )}
            <p className="mt-3 text-center font-body text-[10px] text-[var(--paper-muted)]">
              WASD move · mouse aim · hold to shoot · survive {WAVE_COUNT} waves
            </p>
          </div>
        </div>
      )}

      {/* ── Round-over overlay ── */}
      {over && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--paper-ink)]/45 p-4">
          <div className="w-[min(24rem,92vw)] rotate-[-1deg] rounded-lg border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] p-6 text-center shadow-[6px_6px_0_rgba(0,0,0,0.4)]">
            <p className="font-body text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--paper-red)]">
              {phase === "victory" ? "✂ all bots shredded" : "✕ paper core destroyed"}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold uppercase text-[var(--paper-ink)]">{banner.title}</h2>
            <p className="mt-0.5 font-body text-xs text-[var(--paper-muted)]">{banner.sub}</p>

            <div className="mt-5 space-y-1.5 border-t-2 border-dashed border-[var(--paper-line)] pt-4 text-left">
              {sortedScores.length === 0 && <p className="text-center font-body text-xs text-[var(--paper-muted)]">No shots fired — the bots win this page.</p>}
              {sortedScores.slice(0, 5).map(([id, score], i) => (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-5 font-body text-xs font-bold text-[var(--paper-muted)]">{i + 1}.</span>
                  <span className="h-3 w-3 rounded-full border border-[var(--paper-ink)]" style={{ background: colorOf(id) }} />
                  <span className="font-body text-sm font-semibold text-[var(--paper-ink)]">
                    {id === me.id ? me.handle : peers.find((p) => p.id === id)?.handle ?? "?"}
                  </span>
                  <span className="ml-auto font-body text-sm font-bold text-[var(--paper-ink)]">{score}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-center gap-2">
              {isHost && (
                <button type="button" onClick={startRoundAction} className="flex items-center gap-1.5 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-ink)] px-4 py-2 font-body text-xs font-bold text-[var(--paper)] transition-transform hover:-translate-y-0.5 active:translate-y-0">
                  <RotateCcw size={13} /> Next round
                </button>
              )}
              <button type="button" onClick={leaveAction} className="flex items-center gap-1.5 rounded-sm border-2 border-[var(--paper-ink)] bg-[var(--paper-card)] px-4 py-2 font-body text-xs font-bold text-[var(--paper-ink)] transition-transform hover:-translate-y-0.5 active:translate-y-0">
                <Home size={13} /> Leave arena
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
