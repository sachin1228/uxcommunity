"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * One realtime room for a Paper Bots game.
 *
 * Transport: Supabase Realtime (broadcast + presence) — already part of the
 * stack (supabase-js is the shared browser client), so multiplayer needs no
 * extra infra and works from localhost against the project's Supabase.
 *
 * This wrapper uses its OWN supabase-js instance with a higher
 * events-per-second allowance than the app-wide throttled singleton, because a
 * game broadcasts continuous position + snapshot frames that would blow the
 * 10 eps cap used for chat-style traffic.
 *
 * Roles: every peer tracks presence with a `joinedAt`. The earliest join is
 * the HOST — it runs the authoritative bot/core simulation and broadcasts
 * snapshots. Everyone else sends movement/shot/hit events and renders the
 * host's snapshots. If the host drops, the earliest remaining peer takes over.
 */

const EV = {
  move: "m",
  shot: "s",
  hit: "h",
  snap: "S",
  cmd: "c",
} as const;

export type PaperCmd =
  | { cmd: "start" }
  | { cmd: "restart" }
  | { cmd: "pause" }
  | { cmd: "resume" };

export interface PeerMeta {
  id: string;
  handle: string;
  avatar: string | null;
  joinedAt: number;
}

export interface PaperMe {
  id: string;
  handle: string;
  avatar: string | null;
}

export interface PaperRoomHandlers {
  onRoster?: (peers: PeerMeta[]) => void;
  onMove?: (from: string, p: { x: number; y: number; angle: number; moving: boolean }) => void;
  onShot?: (from: string, p: { x: number; y: number; angle: number; bulletId: number }) => void;
  onHitClaim?: (from: string, p: { bulletId: number; botId: number }) => void;
  onSnapshot?: (payload: unknown) => void;
  onCommand?: (from: string, payload: PaperCmd) => void;
}

let roomClient: ReturnType<typeof createBrowserClient> | null = null;

function client() {
  if (roomClient) return roomClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env for Paper Bots rooms");
  roomClient = createBrowserClient(url, key, {
    realtime: { params: { eventsPerSecond: 60 } },
  });
  return roomClient;
}

export function channelNameFor(code: string): string {
  return `games:${code}`;
}

/** Deterministic host = earliest join (tie-break by id) so all peers agree. */
export function pickHost(peers: PeerMeta[]): string | null {
  if (peers.length === 0) return null;
  let host = peers[0];
  for (const p of peers) {
    if (p.joinedAt < host.joinedAt) host = p;
    else if (p.joinedAt === host.joinedAt && p.id < host.id) host = p;
  }
  return host.id;
}

export class PaperRoom {
  code: string;
  me: PaperMe;
  private channel: RealtimeChannel | null = null;
  private rosterCache: PeerMeta[] = [];
  private status: "connecting" | "SUBSCRIBED" | "error" | "closed" = "connecting";
  private handlers: PaperRoomHandlers = {};

  private constructor(code: string, me: PaperMe) {
    this.code = code;
    this.me = me;
  }

  static create(code: string, me: PaperMe): PaperRoom {
    return new PaperRoom(code, me);
  }

  get connected(): boolean {
    return this.status === "SUBSCRIBED";
  }

  /** Replace (or clear) the active handler set. */
  setHandlers(h: PaperRoomHandlers): void {
    this.handlers = h;
    // Presence is cached client-side — replay the current roster right away.
    if (h.onRoster && this.rosterCache.length) {
      try {
        h.onRoster(this.rosterCache);
      } catch {
        /* noop */
      }
    }
  }

  roster(): PeerMeta[] {
    return this.rosterCache;
  }

  /** Subscribe + track presence. Resolves true when live. */
  async join(): Promise<boolean> {
    const channel = client().channel(channelNameFor(this.code), {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.me.id },
      },
    });
    this.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      const raw = channel.presenceState() as Record<
        string,
        Array<{ handle?: string; avatar?: string | null; joinedAt?: number }>
      >;
      const peers: PeerMeta[] = [];
      for (const [id, metas] of Object.entries(raw)) {
        const m = metas?.[0];
        peers.push({
          id,
          handle: m?.handle ?? id.slice(0, 6),
          avatar: m?.avatar ?? null,
          joinedAt: m?.joinedAt ?? Number.MAX_SAFE_INTEGER,
        });
      }
      peers.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      this.rosterCache = peers;
      this.handlers.onRoster?.(peers);
    });

    channel.on("broadcast", { event: EV.move }, (msg) => {
      const p = msg.payload as { from?: string; x: number; y: number; angle: number; moving: boolean };
      this.handlers.onMove?.(p.from ?? "", p);
    });
    channel.on("broadcast", { event: EV.shot }, (msg) => {
      const p = msg.payload as { from?: string; x: number; y: number; angle: number; bulletId: number };
      this.handlers.onShot?.(p.from ?? "", p);
    });
    channel.on("broadcast", { event: EV.hit }, (msg) => {
      const p = msg.payload as { from?: string; bulletId: number; botId: number };
      this.handlers.onHitClaim?.(p.from ?? "", p);
    });
    channel.on("broadcast", { event: EV.snap }, (msg) => {
      this.handlers.onSnapshot?.(msg.payload);
    });
    channel.on("broadcast", { event: EV.cmd }, (msg) => {
      const p = msg.payload as { from?: string } & PaperCmd;
      this.handlers.onCommand?.(p.from ?? "", p);
    });

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.status !== "SUBSCRIBED") {
          this.status = "error";
          resolve(false);
        }
      }, 5000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.status = status;
          void channel.track({
            handle: this.me.handle,
            avatar: this.me.avatar,
            joinedAt: Date.now(),
          });
          clearTimeout(timer);
          resolve(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          this.status = "error";
          resolve(false);
        }
      });
    });
  }

  sendMove(p: { x: number; y: number; angle: number; moving: boolean }): void {
    this.broadcast(EV.move, { from: this.me.id, ...p });
  }

  sendShot(p: { x: number; y: number; angle: number; bulletId: number }): void {
    this.broadcast(EV.shot, { from: this.me.id, ...p });
  }

  sendHitClaim(p: { bulletId: number; botId: number }): void {
    this.broadcast(EV.hit, { from: this.me.id, ...p });
  }

  sendSnapshot(payload: unknown): void {
    this.broadcast(EV.snap, payload);
  }

  sendCommand(p: PaperCmd): void {
    this.broadcast(EV.cmd, { from: this.me.id, ...p });
  }

  leave(): void {
    try {
      void this.channel?.untrack();
    } catch {
      /* noop */
    }
    try {
      void this.channel?.unsubscribe();
    } catch {
      /* noop */
    }
    this.channel = null;
    this.status = "closed";
    this.rosterCache = [];
    this.handlers = {};
  }

  private broadcast(topic: string, payload: unknown): void {
    if (this.status !== "SUBSCRIBED" || !this.channel) return;
    try {
      void this.channel.send({ type: "broadcast", event: topic, payload });
    } catch {
      /* noop */
    }
  }
}
