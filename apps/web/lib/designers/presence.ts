"use client";

/**
 * Presence + signaling for the 3D designer studio, built on the app's
 * Cloudflare Realtime service (one WebSocket per room).
 *
 * - Server-side presence tells us who is in the room (name/avatar).
 * - Positions are published as low-trust events on the `pos` topic at a
 *   throttled rate; the server excludes the sender, so each client only
 *   receives other users.
 * - WebRTC signaling rides on the `signal` topic, targeted by userId.
 */

import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

export interface RemoteUser {
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
  onOnlineCount: (count: number) => void;
  onConnected: (connected: boolean) => void;
  onSignal: (from: string, data: SignalPayload) => void;
}

const POS_TOPIC = "pos";
const SIGNAL_TOPIC = "signal";
const TRACK_MS = 130; // ~8Hz position updates

export class StudioPresence {
  private client: RealtimeClient;
  private userId: string;
  private opts: PresenceOptions;
  private remoteUsers = new Map<string, RemoteUser>();
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
    this.client.on(SIGNAL_TOPIC, (data, sender) => this.onSignal(data, sender));
    this.client.onPresence((users) => {
      this.opts.onOnlineCount(users.length);
    });
    this.client.onStatus((connected) => {
      this.opts.onConnected(connected);
    });
  }

  connect() {
    this.client.connect();
  }

  /** Publish our position, throttled, so everyone else sees us move. */
  updatePosition(x: number, z: number, heading: number) {
    this.lastX = x;
    this.lastZ = z;
    this.lastHeading = heading;
    const now = Date.now();
    if (now - this.lastTrackAt < TRACK_MS) return;
    this.lastTrackAt = now;
    this.client.publish(POS_TOPIC, {
      x: Math.round(x * 100) / 100,
      z: Math.round(z * 100) / 100,
      heading: Math.round(heading * 100) / 100,
      mic: this.mic,
    });
  }

  setMic(on: boolean) {
    this.mic = on;
    // publish immediately so others see the mic state change
    this.client.publish(POS_TOPIC, {
      x: Math.round(this.lastX * 100) / 100,
      z: Math.round(this.lastZ * 100) / 100,
      heading: Math.round(this.lastHeading * 100) / 100,
      mic: on,
    });
  }

  sendSignal(to: string, data: SignalPayload) {
    this.client.publish(SIGNAL_TOPIC, { to, data });
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

  private onPos(data: unknown, sender?: string) {
    if (!sender || sender === this.userId) return;
    const d = data as { x?: number; z?: number; heading?: number; mic?: boolean };
    if (typeof d.x !== "number" || typeof d.z !== "number") return;
    const existing = this.remoteUsers.get(sender);
    this.remoteUsers.set(sender, {
      id: sender,
      name: existing?.name ?? sender,
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

  private onSignal(data: unknown, sender?: string) {
    if (!sender || sender === this.userId) return;
    const d = data as { to?: string; data?: SignalPayload };
    if (!d.data || (d.to && d.to !== this.userId)) return;
    this.opts.onSignal(sender, d.data);
  }
}
