"use client";

/**
 * WebRTC proximity voice for the designer studio (full mesh).
 *
 * - A peer connection is formed with every remote user who has their mic on.
 * - Glare-free negotiation: the user with the lexicographically smaller id
 *   always creates the offer; the other side answers.
 * - Each peer's <audio> element volume is driven by 3D distance each frame,
 *   so voices fade in/out as you walk around (proximity voice).
 *
 * Signaling rides over the studio's realtime channel (see presence.ts).
 */

import type { RemoteUser, SignalPayload } from "./presence";

// Proximity hearing: you only hear people close to you (walk up to someone
// to talk). Everyone in the room is connected, so a listener never needs
// their mic on to hear — the mic only controls whether they transmit.
const VOICE_RADIUS = 7;
const FADE_FROM = 1.5;
const VOLUME_MS = 150;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] },
];

interface Vec2 {
  x: number;
  z: number;
}

export class ProximityVoice {
  private selfId: string;
  private sendSignal: (to: string, data: SignalPayload) => void;
  private peers = new Map<string, RTCPeerConnection>();
  private audioEls = new Map<string, HTMLAudioElement>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private micEnabled = false;
  private lastVolumeAt = 0;

  constructor(selfId: string, sendSignal: (to: string, data: SignalPayload) => void) {
    this.selfId = selfId;
    this.sendSignal = sendSignal;
  }

  get micOn() {
    return this.micEnabled;
  }

  /** Ask for the microphone. Returns false when denied / unsupported. */
  async enableMic(): Promise<boolean> {
    if (this.micEnabled) return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    this.micEnabled = true;
    // rebuild peers so our audio track is attached (fresh negotiation)
    this.closeAllPeers();
    return true;
  }

  disableMic() {
    this.micEnabled = false;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.closeAllPeers();
  }

  /**
   * Reconcile peer connections with everyone in the room.
   *
   * Connections form between ALL users, so a nearby listener can always
   * hear you without turning their mic on (no mic permission needed to
   * listen). Your own mic only controls whether your audio track is
   * attached — turn it on when you want to speak. Call whenever presence
   * changes (someone joins/leaves).
   */
  syncTargets(users: RemoteUser[]) {
    const targets = new Set(
      users.filter((u) => u.id !== this.selfId).map((u) => u.id)
    );
    for (const id of [...this.peers.keys()]) {
      if (!targets.has(id)) this.closePeer(id);
    }
    for (const id of targets) {
      if (!this.peers.has(id)) this.ensurePeer(id, this.selfId < id);
    }
  }

  handleSignal(from: string, data: SignalPayload) {
    if (from === this.selfId) return;
    switch (data.type) {
      case "offer": {
        const pc = this.ensurePeer(from, false);
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            if (pc.localDescription) {
              this.sendSignal(from, { type: "answer", sdp: pc.localDescription });
            }
          })
          .catch(() => this.closePeer(from));
        break;
      }
      case "answer": {
        const pc = this.peers.get(from);
        if (!pc) return;
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(() =>
          this.closePeer(from)
        );
        break;
      }
      case "ice": {
        const pc = this.peers.get(from);
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          const buf = this.pendingIce.get(from) ?? [];
          buf.push(data.candidate);
          this.pendingIce.set(from, buf);
        }
        break;
      }
    }
  }

  /** Called every frame (internally throttled): fade audio by 3D distance. */
  updateVolumes(player: Vec2, remotes: Array<{ id: string; x: number; z: number }>, masterMuted: boolean) {
    const now = Date.now();
    if (now - this.lastVolumeAt < VOLUME_MS) return;
    this.lastVolumeAt = now;
    for (const [id, audio] of this.audioEls) {
      const r = remotes.find((u) => u.id === id);
      const d = r ? Math.hypot(r.x - player.x, r.z - player.z) : Infinity;
      const vol =
        masterMuted || d > VOICE_RADIUS
          ? 0
          : Math.max(0, Math.min(1, 1 - (d - FADE_FROM) / (VOICE_RADIUS - FADE_FROM)));
      audio.volume = vol;
    }
  }

  dispose() {
    this.closeAllPeers();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  // ── internals ────────────────────────────────────────────────────────────────
  private ensurePeer(remoteId: string, initiate: boolean): RTCPeerConnection {
    const existing = this.peers.get(remoteId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(remoteId, pc);
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    const audio = new Audio();
    audio.autoplay = true;
    audio.volume = 0;
    this.audioEls.set(remoteId, audio);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal(remoteId, { type: "ice", candidate: e.candidate.toJSON() });
      }
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        this.closePeer(remoteId);
      }
    };

    // flush any ICE candidates that arrived before this connection
    const buffered = this.pendingIce.get(remoteId);
    if (buffered) {
      this.pendingIce.delete(remoteId);
      for (const cand of buffered) {
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
    }

    if (initiate) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          if (pc.localDescription) {
            this.sendSignal(remoteId, { type: "offer", sdp: pc.localDescription });
          }
        })
        .catch(() => this.closePeer(remoteId));
    }
    return pc;
  }

  private closePeer(remoteId: string) {
    const pc = this.peers.get(remoteId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      this.peers.delete(remoteId);
    }
    const audio = this.audioEls.get(remoteId);
    if (audio) {
      audio.srcObject = null;
      audio.pause();
      this.audioEls.delete(remoteId);
    }
  }

  private closeAllPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }
}
