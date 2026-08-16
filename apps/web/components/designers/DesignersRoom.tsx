"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mic, Send, Volume2, VolumeX } from "lucide-react";
import { DesignersRoom, FrameState, RoomDesigner } from "@/lib/designers/room";
import { PERSONAS } from "@/lib/designers/personas";
import { Spinner } from "@/components/ui/Spinner";

interface Bubble {
  id: string;
  name: string;
  role: string;
  color: string;
  text: string;
}

const RADAR_SCALE = 56 / 15; // px per world unit

export function DesignersRoomView() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<DesignersRoom | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [nearby, setNearby] = useState<RoomDesigner | null>(null);
  const nearbyRef = useRef<RoomDesigner | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [typing, setTyping] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hint, setHint] = useState(true);
  const [message, setMessage] = useState("");

  const radarDots = useRef<Record<string, HTMLDivElement | null>>({});
  const playerDot = useRef<HTMLDivElement>(null);
  const bubbleTimer = useRef<number | null>(null);

  // ── Voice (browser TTS) ──────────────────────────────────────────────────────
  const speakLine = useCallback((text: string) => {
    if (mutedRef.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const en = voices.find((v) => v.lang.toLowerCase().startsWith("en"));
      if (en) u.voice = en;
      u.rate = 1.03;
      u.pitch = 1.02;
      u.volume = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {
      setSpeaking(false);
    }
  }, []);

  // ── Radar ────────────────────────────────────────────────────────────────────
  const updateRadar = useCallback((s: FrameState) => {
    for (const d of s.designers) {
      const el = radarDots.current[d.id];
      if (!el) continue;
      let sx = (d.x - s.playerX) * RADAR_SCALE;
      let sy = -(d.z - s.playerZ) * RADAR_SCALE;
      const dist = Math.hypot(sx, sy);
      const max = 52;
      if (dist > max) {
        sx = (sx / dist) * max;
        sy = (sy / dist) * max;
      }
      el.style.transform = `translate(${sx}px, ${sy}px)`;
      el.style.opacity = d.nearby ? "1" : "0.8";
      el.style.boxShadow = d.nearby ? "0 0 0 3px rgba(0,112,243,0.55)" : "none";
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
        onNearby: (d) => {
          nearbyRef.current = d;
          setNearby(d);
        },
        onSpeak: (d, text) => {
          setBubble({ id: d.id, name: d.name, role: d.role, color: d.color, text });
          if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
          bubbleTimer.current = window.setTimeout(() => setBubble(null), 8000);
          speakLine(text);
        },
        onTyping: (_d, t) => setTyping(t),
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

    // warm up voices
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    const onLock = () => setLocked(room.isLocked());
    document.addEventListener("pointerlockchange", onLock);

    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
      room.dispose();
      roomRef.current = null;
    };
  }, [updateRadar, speakLine]);

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

  const toggleMute = () => {
    setMuted((m) => {
      mutedRef.current = !m;
      if (!mutedRef.current && "speechSynthesis" in window) {
        // unmuting: nothing queued — voices resume on next speech
      }
      return !m;
    });
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || !nearbyRef.current) return;
    setBubble({
      id: nearbyRef.current.id,
      name: nearbyRef.current.name,
      role: nearbyRef.current.role,
      color: nearbyRef.current.color,
      text: `You: ${text}`,
    });
    setTyping(true);
    roomRef.current?.say(nearbyRef.current.id, text);
    setMessage("");
  };

  const leave = () => {
    document.exitPointerLock?.();
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
    roomRef.current?.addTouchLook(dx, dy);
  };
  const onLookUp = () => {
    lookPos.current = null;
  };

  const nearbyColor = nearby?.color ?? "#0070F3";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f2e7d3] text-foreground">
      {/* 3D canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading */}
      {!ready && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background">
          <Spinner className="h-9 w-9" />
          <p className="font-body text-sm text-foreground-muted">Entering the studio…</p>
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

      {/* Top-left: leave */}
      {ready && (
        <button
          type="button"
          onClick={leave}
          className="absolute left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/70 text-foreground-muted backdrop-blur transition-colors hover:text-foreground"
          aria-label="Leave the room"
          title="Leave the room"
        >
          <ArrowLeft size={18} />
        </button>
      )}

      {/* Top-right: room name + mute */}
      {ready && (
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          <span className="hidden rounded-lg border border-border bg-background/70 px-3 py-1.5 font-body text-xs font-medium text-foreground backdrop-blur sm:block">
            Designer Studio
          </span>
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
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-border bg-background/70 px-4 py-1.5 font-body text-xs text-foreground-muted backdrop-blur">
          WASD to move · Mouse to look · Shift to sprint · Walk up to a designer to talk
        </div>
      )}

      {/* Pointer-lock overlay (desktop) */}
      {ready && !error && !locked && !isTouch && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/30 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background/80 px-8 py-6 text-center shadow-xl backdrop-blur">
            <span className="text-3xl">🎮</span>
            <p className="font-body text-sm font-semibold text-foreground">You&apos;re in the Designer Studio</p>
            <p className="max-w-xs font-body text-xs text-foreground-muted">
              Walk around with WASD, look around with your mouse, and walk up to a designer to have a chat.
            </p>
            <button
              type="button"
              onClick={() => roomRef.current?.requestLock()}
              className="mt-1 rounded-lg bg-accent px-5 py-2 font-body text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Click to look around
            </button>
          </div>
        </div>
      )}

      {/* Chat panel (near a designer) */}
      {ready && nearby && !error && (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2">
          <div className="overflow-hidden rounded-2xl border border-border bg-background/85 shadow-xl backdrop-blur">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body text-sm font-bold text-white"
                style={{ background: nearbyColor }}
              >
                {nearby.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-sm font-semibold text-foreground">
                  {nearby.name}
                  <span className="ml-2 font-body text-[11px] font-normal text-foreground-muted">{nearby.role}</span>
                </p>
                <p className="flex items-center gap-1 font-body text-[11px] text-accent">
                  <Mic size={11} className={speaking ? "animate-pulse" : "opacity-60"} />
                  {speaking ? "speaking…" : "in the room"}
                </p>
              </div>
            </div>
            <div className="min-h-[3.5rem] px-4 py-3">
              {bubble && bubble.id === nearby.id ? (
                <p className="font-body text-sm leading-relaxed text-foreground">
                  {bubble.text.startsWith("You:") ? (
                    <>
                      <span className="font-semibold text-accent">{bubble.text.slice(0, 4)}</span>
                      {bubble.text.slice(4)}
                    </>
                  ) : (
                    bubble.text
                  )}
                </p>
              ) : typing ? (
                <span className="inline-flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-muted"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              ) : (
                <p className="font-body text-xs italic text-foreground-muted">
                  Walk away to leave the conversation.
                </p>
              )}
            </div>
            <form onSubmit={send} className="flex items-center gap-2 border-t border-border px-3 py-2.5">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Say something to ${nearby.name}…`}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 font-body text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-accent"
                aria-label="Type a message"
              />
              <button
                type="submit"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={!message.trim()}
                aria-label="Send message"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Radar */}
      {ready && !error && (
        <div className="pointer-events-none absolute bottom-5 right-5 z-20 hidden h-32 w-32 items-center justify-center sm:flex">
          <div className="absolute inset-0 rounded-full border border-border bg-background/50 backdrop-blur" />
          <div className="absolute inset-4 rounded-full border border-border/70" />
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,transparent_58%,rgba(0,112,243,0.08))]" />
          {PERSONAS.map((p) => (
            <div
              key={p.id}
              ref={(el) => {
                radarDots.current[p.id] = el;
              }}
              className="absolute left-1/2 top-1/2 -ml-[5px] -mt-[5px] h-2.5 w-2.5 rounded-full border border-white/70"
              style={{ background: p.color }}
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
          <div
            className="absolute bottom-0 right-0 top-0 z-20 w-1/2 touch-none"
            onPointerDown={onLookDown}
            onPointerMove={onLookMove}
            onPointerUp={onLookUp}
            onPointerCancel={onLookUp}
          >
            <span className="pointer-events-none absolute right-6 top-16 rounded-full bg-background/60 px-3 py-1 font-body text-[10px] text-foreground-muted backdrop-blur">
              drag to look
            </span>
          </div>
        </>
      )}
    </div>
  );
}
