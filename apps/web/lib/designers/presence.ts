"use client";

/**
 * Presence + signaling for the 3D designer studio, built on the app's
 * Cloudflare Realtime service (one WebSocket per room).
 *
 * - Server-side presence tells us who is in the room (name/avatar).
 * - Positions are published as low-trust events on the `pos` topic at a
 *   throttled rate; the server excludes the sending socket, so every other
 *   tab/user receives them (including the same account's other tabs).
 * - Each tab has its own `instanceId`, so the same user can be in the room
 *   from several windows — each instance appears as its own avatar and
 *   forms its own voice peer. The identity for avatars/voice is the
 *   composite `userId:instanceId`.
 * - WebRTC signaling rides on the `signal` topic, targeted by composite id.
 */

import { RealtimeClient, RealtimePresenceUser } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

export interface RemoteUser {
  /** Composite `userId:instanceId` — one avatar per tab, even for the same user. */
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  mic: boolean;
}

export type SignalPayload =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

interface PresenceOptions {
  userId: string;
  name: string;
  avatar: string | null;
  onRemoteUsers: (users: RemoteUser[]) => void;
  onPresenceUsers: (users: RealtimePresenceUser[]) => void;
  onOnlineCount: (count: number) => void;
  onConnected: (connected: boolean) => void;
  onSignal: (from: string, data: SignalPayload) => void;
}

const POS_TOPIC = "pos";
const SIGNAL_TOPIC = "signal";
const TRACK_MS = 130; // ~8Hz position updates

function makeInstanceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class StudioPresence {
  private client: RealtimeClient;
  private userId: string;
  private instanceId = makeInstanceId();
  private opts: PresenceOptions;
  private remoteUsers = new Map<string, RemoteUser>();
  private nameByUserId = new Map<string, string>();
  private mic = false;
  private lastX = 0;
  private lastZ = 6.6;
  private lastHeading = 0;
  private lastTrackAt = 0;
  private remoteDirty = false;
  private remoteTimer: number | null = null;

  constructor(opts: PresenceOptions) {
    this.userId = opts.userId;
    this.opts = opts;
    this.client = new RealtimeClient({
      room: realtimeRooms.designers(),
      user: { id: opts.userId, name: opts.name, avatar: opts.avatar },
    });

    this.client.on(POS_TOPIC, (data, sender) => this.onPos(data, sender));
    this.client.on(SIGNAL_TOPIC, (data) => this.onSignal(data));
    this.client.onPresence((users) => {
      for (const u of users) this.nameByUserId.set(u.id, u.name ?? u.id);
      this.opts.onOnlineCount(users.length);
      this.opts.onPresenceUsers(users);
    });
    this.client.onStatus((connected) => {
      this.opts.onConnected(connected);
    });
  }

  connect() {
    this.client.connect();
  }

  /** Composite identity for this tab: `userId:instanceId`. */
  getSelfId(): string {
    return `${this.userId}:${this.instanceId}`;
  }

  /** Publish our position, throttled, so everyone else sees us move. */
  updatePosition(x: number, z: number, heading: number) {
    this.lastX = x;
    this.lastZ = z;
    this.lastHeading = heading;
    const now = Date.now();
    if (now - this.lastTrackAt < TRACK_MS) return;
    this.lastTrackAt = now;
    this.publishPos();
  }

  setMic(on: boolean) {
    this.mic = on;
    // publish immediately so others see the mic state change
    this.publishPos();
  }

  sendSignal(to: string, data: SignalPayload) {
    this.client.publish(SIGNAL_TOPIC, {
      from: this.getSelfId(),
      to,
      data,
    });
  }

  getRemoteUsers(): RemoteUser[] {
    return [...this.remoteUsers.values()];
  }

  close() {
    if (this.remoteTimer !== null) {
      window.clearTimeout(this.remoteTimer);
      this.remoteTimer = null;
    }
    this.client.close();
  }

  private publishPos() {
    this.client.publish(POS_TOPIC, {
      uid: this.userId,
      iid: this.instanceId,
      x: Math.round(this.lastX * 100) / 100,
      z: Math.round(this.lastZ * 100) / 100,
      heading: Math.round(this.lastHeading * 100) / 100,
      mic: this.mic,
    });
  }

  private onPos(data: unknown, sender?: string) {
    const d = data as { uid?: string; iid?: string; x?: number; z?: number; heading?: number; mic?: boolean };
    const uid = d.uid ?? sender;
    const iid = d.iid;
    if (!uid || !iid) return;
    if (uid === this.userId && iid === this.instanceId) return; // our own tab
    if (typeof d.x !== "number" || typeof d.z !== "number") return;
    const composite = `${uid}:${iid}`;
    const existing = this.remoteUsers.get(composite);
    this.remoteUsers.set(composite, {
      id: composite,
      name: existing?.name ?? this.nameByUserId.get(uid) ?? uid,
      x: d.x,
      z: d.z,
      heading: typeof d.heading === "number" ? d.heading : 0,
      mic: Boolean(d.mic),
    });
    // coalesce rapid position streams into ~10Hz snapshots
    this.remoteDirty = true;
    if (this.remoteTimer === null) {
      this.remoteTimer = window.setTimeout(() => {
        this.remoteTimer = null;
        if (this.remoteDirty) {
          this.remoteDirty = false;
          this.opts.onRemoteUsers(this.getRemoteUsers());
        }
      }, 100);
    }
  }

  private onSignal(data: unknown) {
    const d = data as { from?: string; to?: string; data?: SignalPayload };
    if (!d.data) return;
    if (d.from === this.getSelfId()) return; // our own other tab
    if (d.to && d.to !== this.getSelfId()) return;
    this.opts.onSignal(d.from ?? "unknown", d.data);
  }
}
