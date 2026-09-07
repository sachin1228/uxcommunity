"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Copy,
  Crosshair,
  Joystick,
  Link2,
  Pencil,
  Plus,
  Shield,
  Sparkles,
} from "lucide-react";
import { generateRoomCode, normalizeRoomCode } from "@/lib/games/roomCode";
import { PaperRoom } from "@/lib/games/paperRoom";
import { PaperArena, type ArenaIdentity } from "./PaperArena";

async function fetchIdentity(): Promise<ArenaIdentity | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as {
      user?: { id?: string; name?: string; email?: string; avatar_url?: string | null };
    } | null;
    const u = data?.user;
    if (u?.id && u.name) {
      return { id: u.id, handle: u.name, avatar: u.avatar_url ?? null };
    }
    if (u?.id) return { id: u.id, handle: u.email?.split("@")[0] ?? "designer", avatar: u.avatar_url ?? null };
    return null;
  } catch {
    return null;
  }
}

export function GamesHome({ initialRoom }: { initialRoom?: string }) {
  const [me, setMe] = useState<ArenaIdentity | null>(null);
  const [room, setRoom] = useState<PaperRoom | null>(null);
  const [code, setCode] = useState("SOLO");
  const [inArena, setInArena] = useState(false);
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoJoinHandled = useRef(false);
  const activeRoomRef = useRef<PaperRoom | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchIdentity().then((m) => {
      if (!cancelled) setMe(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link join (?room=CODE).
  useEffect(() => {
    if (!me || autoJoinHandled.current) return;
    const raw = (initialRoom ?? "").trim();
    if (!raw) return;
    const valid = normalizeRoomCode(raw);
    if (!valid) return;
    autoJoinHandled.current = true;
    joinRoom(valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, initialRoom]);

  function leaveRoom() {
    activeRoomRef.current?.leave();
    activeRoomRef.current = null;
    setRoom(null);
    setInArena(false);
  }

  function joinRoom(roomCode: string) {
    if (!me) return;
    activeRoomRef.current?.leave();
    activeRoomRef.current = null;
    const r = PaperRoom.create(roomCode, { id: me.id, handle: me.handle, avatar: me.avatar });
    activeRoomRef.current = r;
    setCode(roomCode);
    setRoom(r);
    setInArena(true);
    setJoinError(null);
  }

  function createRoom() {
    if (!me) return;
    joinRoom(generateRoomCode());
  }

  function startSolo() {
    if (!me) return;
    activeRoomRef.current?.leave();
    activeRoomRef.current = null;
    setCode("SOLO");
    setRoom(null);
    setInArena(true);
  }

  function submitJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    const valid = normalizeRoomCode(joinInput);
    if (!valid) {
      setJoinError("Enter the 5-character room code from the invite link.");
      return;
    }
    joinRoom(valid);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/games?room=${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  }

  if (!me) {
    return (
      <div className="paper-root flex h-full w-full items-center justify-center overflow-hidden p-6">
        <div className="paper-panel flex items-center gap-3 px-5 py-4">
          <span className="h-3 w-3 animate-pulse rounded-full border-2 border-[var(--paper-ink)] bg-[var(--paper-red)]" />
          <p className="font-body text-sm font-semibold text-[var(--paper-ink)]">Pinning your name tag to the bench…</p>
        </div>
      </div>
    );
  }

  if (inArena) {
    return (
      <div className="paper-root h-full w-full overflow-hidden">
        <PaperArena
          me={me}
          room={room}
          code={code}
          key={`${code}:${room ? "mp" : "solo"}`}
          onExit={leaveRoom}
        />
      </div>
    );
  }

  return (
    <div className="paper-root h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        {/* ── Header ── */}
        <header className="relative">
          <span className="pchip">uxcommunity · experimental</span>
          <h1 className="mt-3 font-display text-4xl font-bold uppercase tracking-tight text-[var(--paper-ink)] sm:text-5xl">
            Paper Bots
          </h1>
          <p className="mt-1 max-w-xl font-body text-sm text-[var(--paper-muted)]">
            A co-op arena drawn straight on paper — shred waves of sketchy bots with
            friends before they eat the Paper Core. Multiplayer, live, in your browser.
          </p>
          <div className="pointer-events-none absolute -top-2 right-0 hidden rotate-6 sm:block">
            <div className="paper-panel px-3 py-2 font-body text-[10px] font-bold uppercase tracking-widest text-[var(--paper-red)]">
              ✂ v0.1 wireframe build
            </div>
          </div>
        </header>

        {/* ── How to play strip ── */}
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { icon: <Crosshair size={17} />, t: "Move & aim", d: "WASD to walk the sheet, mouse to aim. Hold click to fire pencil tracers." },
            { icon: <Bot size={17} />, t: "Shred the bots", d: "Every bot you crumple is +10. Bots shoot back and chase — don't get folded." },
            { icon: <Shield size={17} />, t: "Protect the core", d: "Survive all 5 waves and keep the Paper Core (centre fort) from being eaten." },
          ].map((c, i) => (
            <div key={c.t} className="paper-panel-soft p-3.5">
              <div className="flex items-center gap-2 text-[var(--paper-ink)]">
                {c.icon}
                <span className="font-body text-xs font-bold uppercase tracking-wide">{c.t}</span>
                <span className="ml-auto font-body text-[10px] text-[var(--paper-red)]">step {i + 1}</span>
              </div>
              <p className="mt-1.5 font-body text-xs leading-relaxed text-[var(--paper-muted)]">{c.d}</p>
            </div>
          ))}
        </div>

        {/* ── Actions ── */}
        <div className="mt-7 grid gap-5 md:grid-cols-[1fr_1fr]">
          {/* Create */}
          <section className="paper-panel p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--paper-ink)] bg-[var(--paper)] text-[var(--paper-ink)]">
                <Plus size={16} />
              </span>
              <h2 className="font-display text-lg font-bold uppercase tracking-wide text-[var(--paper-ink)]">Start a room</h2>
            </div>
            <p className="mt-2 font-body text-xs leading-relaxed text-[var(--paper-muted)]">
              Host a fresh arena. You get a 5-letter code — send it to friends (or open a
              second tab) and they join live as co-op players.
            </p>
            <button type="button" onClick={createRoom} className="pbtn pbtn-ink mt-4 w-full">
              <Sparkles size={15} /> Create paper room
            </button>
            <div className="mt-3 border-t-2 border-dashed border-[var(--paper-line)] pt-3">
              <button type="button" onClick={startSolo} className="pbtn pbtn-dash w-full">
                <Pencil size={14} /> …or sketch alone
              </button>
            </div>
          </section>

          {/* Join */}
          <section className="paper-panel p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--paper-ink)] bg-[var(--paper)] text-[var(--paper-ink)]">
                <Joystick size={16} />
              </span>
              <h2 className="font-display text-lg font-bold uppercase tracking-wide text-[var(--paper-ink)]">Join a room</h2>
            </div>
            <p className="mt-2 font-body text-xs leading-relaxed text-[var(--paper-muted)]">
              Got an invite code? Drop it in and hop onto someone else&apos;s sheet.
            </p>
            <form onSubmit={submitJoin} className="mt-4">
              <div className="flex gap-2">
                <input
                  value={joinInput}
                  onChange={(e) => {
                    setJoinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
                    setJoinError(null);
                  }}
                  placeholder="CODE"
                  aria-label="Room code"
                  maxLength={5}
                  className="pinput flex-1"
                />
                <button type="submit" className="pbtn pbtn-ink shrink-0" aria-label="Join room">
                  <ArrowRight size={16} />
                </button>
              </div>
              {joinError && (
                <p className="mt-2 rounded-sm border border-[var(--paper-red)] bg-[#fbeaea] px-2 py-1.5 font-body text-[11px] text-[var(--paper-red)]">
                  {joinError}
                </p>
              )}
            </form>
            <div className="mt-3 flex items-center gap-2 border-t-2 border-dashed border-[var(--paper-line)] pt-3">
              <Link2 size={13} className="shrink-0 text-[var(--paper-muted)]" />
              <p className="font-body text-[11px] leading-relaxed text-[var(--paper-muted)]">
                Joining as <span className="font-semibold text-[var(--paper-ink)]">{me.handle}</span>. Invite links look like{" "}
                <span className="font-mono text-[var(--paper-ink)]">…/games?room=CODE</span>.
              </p>
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <footer className="mt-auto flex flex-col items-center gap-2 pt-10 text-center">
          <div className="flex items-center gap-2">
            <Copy size={13} className="text-[var(--paper-muted)]" />
            <p className="font-body text-[11px] text-[var(--paper-muted)]">
              Multiplayer runs on realtime broadcast + presence — no servers to babysit.
            </p>
          </div>
          {code !== "SOLO" && (
            <button type="button" onClick={() => void copyCode()} className="pchip cursor-pointer hover:text-[var(--paper-ink)]">
              {copied ? "Copied!" : "Copy last invite link"}
            </button>
          )}
          <p className="font-body text-[10px] text-[var(--paper-line)]">
            drawn with paper · ink · one red pencil · inspired by the Paper Wireframe Kit
          </p>
        </footer>
      </div>
    </div>
  );
}
