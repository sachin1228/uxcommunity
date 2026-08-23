"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { DesignersRoom, FrameState } from "@/lib/designers/room";
import { StudioPresence, RemoteUser } from "@/lib/designers/presence";
import { ProximityVoice } from "@/lib/designers/voice";
import { Spinner } from "@/components/ui/Spinner";

interface Props {
  userId: string;
  userName: string;
}

type MicState = "off" | "on" | "denied" | "unsupported";

interface Toast {
  id: number;
  text: string;
}

const RADAR_SCALE = 56 / 15; // px per world unit

export function DesignersRoomView({ userId, userName }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<DesignersRoom | null>(null);
  const presenceRef = useRef<StudioPresence | null>(null);
  const voiceRef = useRef<ProximityVoice | null>(null);
  const remoteUsersRef = useRef<RemoteUser[]>([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState(true);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [micState, setMicState] = useState<MicState>("off");
  const [online, setOnline] = useState(0);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const [hint, setHint] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const radarDots = useRef<Record<string, HTMLDivElement | null>>({});
  const playerDot = useRef<HTMLDivElement>(null);
  const prevOnlineIds = useRef<Set<string>>(new Set());
  const prevOnlineNames = useRef<Map<string, string>>(new Map());
  const toastId = useRef(0);

  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // ── Per-frame plumbing (radar, presence broadcast, voice volumes) ────────────
  const updateRadar = useCallback((s: FrameState) => {
    presenceRef.current?.updatePosition(s.playerX, s.playerZ, s.playerHeading);
    voiceRef.current?.updateVolumes(
      { x: s.playerX, z: s.playerZ },
      s.remotes,
      mutedRef.current
    );

    for (const r of s.remotes) {
      const el = radarDots.current[r.id];
      if (!el) continue;
      let sx = (r.x - s.playerX) * RADAR_SCALE;
      let sy = -(r.z - s.playerZ) * RADAR_SCALE;
      const dist = Math.hypot(sx, sy);
      const max = 52;
      if (dist > max) {
        sx = (sx / dist) * max;
        sy = (sy / dist) * max;
      }
      el.style.transform = `translate(${sx}px, ${sy}px)`;
      el.style.opacity = r.mic ? "1" : "0.7";
    }
    if (playerDot.current) {
      playerDot.current.style.transform = `rotate(${-s.playerHeading}rad)`;
    }
  }, []);

  // ── Room lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let room: DesignersRoom | null = null;
    try {
      room = new DesignersRoom(el, {
        onReady: () => setReady(true),
        onError: (m) => setError(m),
        onFrame: updateRadar,
      });
    } catch {
      // construction failed (e.g. WebGL unavailable) — surface it after mount
      const t = window.setTimeout(
        () => setError("Could not start the 3D room on this device."),
        0
      );
      return () => window.clearTimeout(t);
    }
    roomRef.current = room;
    room.start();

    return () => {
      room.dispose();
      roomRef.current = null;
    };
  }, [updateRadar]);

  // ── Presence (who is in the room) + WebRTC voice ─────────────────────────────
  useEffect(() => {
    const presence = new StudioPresence({
      userId,
      name: userName,
      avatar: null,
      onPresenceUsers: (users) => {
        const now = new Set(users.map((u) => u.id));
        for (const u of users) {
          if (u.id === userId) continue;
          if (!prevOnlineIds.current.has(u.id)) {
            addToast(`${u.name ?? "Someone"} joined the park`);
          }
          prevOnlineNames.current.set(u.id, u.name ?? "Someone");
        }
        for (const id of prevOnlineIds.current) {
          if (!now.has(id)) {
            addToast(`${prevOnlineNames.current.get(id) ?? "Someone"} left the park`);
          }
        }
        prevOnlineIds.current = now;
      },
      onRemoteUsers: (users) => {
        remoteUsersRef.current = users;
        roomRef.current?.setRemoteUsers(users);
        voiceRef.current?.syncTargets(users);
        setRemoteIds(users.map((u) => u.id));
      },
      onOnlineCount: setOnline,
      onConnected: setRealtimeConnected,
      onSignal: (from, data) => voiceRef.current?.handleSignal(from, data),
    });
    presenceRef.current = presence;
    const voice = new ProximityVoice(presence.getSelfId(), (to, data) =>
      presence.sendSignal(to, data)
    );
    voiceRef.current = voice;
    presence.connect();
    return () => {
      presenceRef.current = null;
      voiceRef.current = null;
      voice.dispose();
      presence.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userName]);

  // coarse-pointer detection without a hydration mismatch or setState-in-effect
  const isTouch = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const mq = window.matchMedia("(pointer: coarse)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }, []),
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false
  );

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 9000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setIntro(false), 7000);
    return () => window.clearTimeout(t);
  }, []);

  const toggleMic = useCallback(async () => {
    if (micState === "on") {
      voiceRef.current?.disableMic();
      presenceRef.current?.setMic(false);
      setMicState("off");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicState("unsupported");
      return;
    }
    const ok = await voiceRef.current?.enableMic();
    if (!ok) {
      setMicState("denied");
      return;
    }
    presenceRef.current?.setMic(true);
    // peers closed by enableMic() — re-form them now that we have a track
    voiceRef.current?.syncTargets(remoteUsersRef.current);
    setMicState("on");
  }, [micState]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      mutedRef.current = !m;
      return !m;
    });
  }, []);

  // Keyboard shortcuts: M = mic, V = voice/speaker mute. The cursor is never
  // captured, so every HUD button is always clickable too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "m") {
        e.preventDefault();
        void toggleMic();
      } else if (k === "v") {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMic, toggleMute]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      addToast("Studio link copied — share it to bring people in");
    } catch {
      addToast("Couldn't copy the link");
    }
  };

  const leave = () => {
    router.push("/dashboard");
  };

  // ── Touch controls ───────────────────────────────────────────────────────────
  const [joy, setJoy] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lookPos = useRef<{ x: number; y: number } | null>(null);

  const onJoyDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    setJoy({ x: ox, y: oy, ox, oy });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onJoyMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joy) return;
    const r = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - r.left - joy.ox;
    let dy = e.clientY - r.top - joy.oy;
    const dist = Math.hypot(dx, dy);
    const R = 46;
    if (dist > R) {
      dx = (dx / dist) * R;
      dy = (dy / dist) * R;
    }
    setJoy({ ...joy, x: joy.ox + dx, y: joy.oy + dy });
    roomRef.current?.setTouchMove(dx / R, -dy / R);
  };
  const onJoyUp = () => {
    setJoy(null);
    roomRef.current?.setTouchMove(0, 0);
  };

  const onLookDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lookPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const last = lookPos.current;
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    lookPos.current = { x: e.clientX, y: e.clientY };
    roomRef.current?.addLook(dx, dy);
  };
  const onLookUp = () => {
    lookPos.current = null;
  };

  const alone = realtimeConnected && online <= 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f2e7d3] text-foreground">
      {/* 3D canvas — drag anywhere (not on the HUD) to look around */}
      <div
        ref={containerRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />

      {/* Loading */}
      {!ready && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background">
          <Spinner className="h-9 w-9" />
          <p className="font-body text-sm text-foreground-muted">Entering the park…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
          <p className="font-body text-sm text-foreground">{error}</p>
          <button
            type="button"
            onClick={leave}
            className="rounded-lg bg-accent px-4 py-2 font-body text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Back to dashboard
          </button>
        </div>
      )}

      {/* Top-left: leave (z-30 so it stays clickable above the unlock overlay) */}
      {ready && (
        <button
          type="button"
          onClick={leave}
          className="absolute left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/70 text-foreground-muted backdrop-blur transition-colors hover:text-foreground"
          aria-label="Leave the room"
          title="Leave the room"
        >
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Top-right: room name + online + mic + mute */}
      {ready && (
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-background/70 px-3 py-1.5 font-body text-xs text-foreground-muted backdrop-blur sm:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                realtimeConnected ? "bg-emerald-500" : "bg-foreground-muted/40"
              }`}
            />
            {realtimeConnected ? `${online} online` : "park offline"}
          </span>
          <span className="hidden rounded-lg border border-border bg-background/70 px-3 py-1.5 font-body text-xs font-medium text-foreground backdrop-blur md:block">
            Bella Park
          </span>
          <button
            type="button"
            onClick={toggleMic}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border border-border backdrop-blur transition-colors ${
              micState === "on"
                ? "bg-accent text-white"
                : "bg-background/70 text-foreground-muted hover:text-foreground"
            }`}
            aria-label={micState === "on" ? "Turn off microphone" : "Turn on microphone"}
            title={
              micState === "on"
                ? "Turn off microphone"
                : micState === "denied"
                  ? "Microphone permission was denied"
                  : micState === "unsupported"
                    ? "Microphone not available on this device"
                    : "Turn on microphone to talk"
            }
          >
            {micState === "on" ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border border-border backdrop-blur transition-colors ${
              muted ? "bg-background/70 text-foreground" : "bg-background/70 text-foreground-muted hover:text-foreground"
            }`}
            aria-label={muted ? "Unmute voice" : "Mute voice"}
            title={muted ? "Unmute voice" : "Mute voice"}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        </div>
      )}

      {/* Controls hint */}
      {ready && hint && !isTouch && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-border bg-background/70 px-4 py-1.5 font-body text-xs text-foreground-muted backdrop-blur">
          WASD to move · Drag in any direction to orbit · Space to jump · Shift to sprint · M mic · V voice
        </div>
      )}

      {/* Persistent shortcut chip */}
      {ready && !hint && !isTouch && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-background/50 px-3 py-1 font-body text-[10px] tracking-wide text-foreground-muted backdrop-blur">
          M mic · V voice · drag to rotate
        </div>
      )}

      {/* Non-blocking intro card — the cursor is always free, so this never traps you */}
      {ready && !error && intro && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="pointer-events-auto mx-4 max-w-sm rounded-2xl border border-border bg-background/90 px-6 py-5 text-center shadow-xl backdrop-blur">
            <span className="text-2xl">🎮</span>
            <p className="mt-1 font-body text-sm font-semibold text-foreground">You&apos;re in Bella Park</p>
            <p className="mt-1 font-body text-xs leading-relaxed text-foreground-muted">
              This is a live room — real people are here right now. Walk up to someone to hear them
              (no mic needed to listen). Press{" "}
              <span className="font-semibold text-foreground">M</span> to turn on your mic when you
              want to talk. Hold your mouse (or finger) and drag to rotate the isometric view.
            </p>
            <button
              type="button"
              onClick={() => setIntro(false)}
              className="mt-3 rounded-lg bg-accent px-4 py-1.5 font-body text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Radar */}
      {ready && !error && (
        <div className="pointer-events-none absolute bottom-5 right-5 z-20 hidden h-32 w-32 items-center justify-center sm:flex">
          <div className="absolute inset-0 rounded-full border border-border bg-background/50 backdrop-blur" />
          <div className="absolute inset-4 rounded-full border border-border/70" />
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,transparent_58%,rgba(0,112,243,0.08))]" />
          {remoteIds.map((id) => (
            <div
              key={id}
              ref={(el) => {
                radarDots.current[id] = el;
              }}
              className="absolute left-1/2 top-1/2 -ml-[6px] -mt-[6px] h-3 w-3 rounded-full border-2 border-white bg-slate-500"
            />
          ))}
          <div
            ref={playerDot}
            className="absolute left-1/2 top-1/2 -ml-[7px] -mt-[7px] h-3.5 w-3.5"
            style={{ transform: "rotate(0rad)" }}
          >
            <div className="mx-auto h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-accent" />
          </div>
          <span className="absolute bottom-1 font-body text-[9px] uppercase tracking-widest text-foreground-muted">
            radar
          </span>
        </div>
      )}

      {/* On-air indicator when transmitting */}
      {ready && !error && micState === "on" && (
        <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/80 px-4 py-1.5 shadow-lg backdrop-blur">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="font-body text-xs font-medium text-foreground">You&apos;re on air — people near you can hear you</span>
        </div>
      )}

      {/* Alone hint + invite */}
      {ready && !error && alone && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/80 py-1.5 pl-4 pr-1.5 shadow-lg backdrop-blur">
          <p className="font-body text-xs text-foreground-muted">
            You&apos;re the only one here right now
          </p>
          <button
            type="button"
            onClick={copyInvite}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-body text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Copy size={12} />
            Copy invite link
          </button>
        </div>
      )}

      {/* Join / leave toasts */}
      {ready && toasts.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-full border border-border bg-background/80 px-4 py-1.5 shadow-lg backdrop-blur"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-body text-xs text-foreground">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Touch controls */}
      {ready && !error && isTouch && (
        <>
          <div
            className="absolute bottom-6 left-6 z-20 h-32 w-32 touch-none"
            onPointerDown={onJoyDown}
            onPointerMove={onJoyMove}
            onPointerUp={onJoyUp}
            onPointerCancel={onJoyUp}
          >
            <div className="absolute inset-0 rounded-full border border-white/40 bg-white/10 backdrop-blur-sm" />
            <div
              className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50 bg-white/25 backdrop-blur-sm"
              style={
                joy
                  ? { transform: `translate(calc(-50% + ${joy.x - joy.ox}px), calc(-50% + ${joy.y - joy.oy}px))` }
                  : undefined
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
