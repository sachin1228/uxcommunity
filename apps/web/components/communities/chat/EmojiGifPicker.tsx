"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Search, X } from "lucide-react";
import type { EmojiClickData } from "emoji-picker-react";
import { Theme } from "emoji-picker-react";

const EmojiPickerReact = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="w-4 h-4 border-2 border-border border-t-foreground-muted rounded-full animate-spin" />
    </div>
  ),
});

type Tab = "emoji" | "gif" | "sticker";

interface GifItem {
  id: string;
  title: string;
  previewUrl: string;
  sendUrl: string;
}

interface EmojiGifPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onGifSelect: (url: string) => void;
}

// ─── GIF / Sticker grid ──────────────────────────────────────────────────────

function GifGrid({ type, onSelect }: { type: "gif" | "sticker"; onSelect: (url: string) => void }) {
  const [query, setQuery]               = useState("");
  const [results, setResults]           = useState<GifItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const fetchGifs = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type, limit: "24" });
      if (q) p.set("q", q);
      const res = await fetch(`/api/giphy?${p}`);
      if (res.status === 503) { setNotConfigured(true); return; }
      if (!res.ok) throw new Error("err");
      const data = await res.json() as { results: GifItem[] };
      setResults(data.results ?? []);
    } catch { /* keep existing */ }
    finally   { setLoading(false); }
  }, [type]);

  useEffect(() => {
    fetchGifs("");
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [fetchGifs]);

  const onQueryChange = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchGifs(q), 380);
  };

  if (notConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-5 text-center">
        <span className="text-2xl">{type === "gif" ? "🎬" : "🎭"}</span>
        <p className="text-xs font-semibold text-foreground">Not configured</p>
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Set a <code className="bg-surface-raised px-1 py-0.5 rounded text-[10px] font-mono">GIPHY_API_KEY</code> env var to enable {type}s.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <div className="flex items-center gap-1.5 bg-surface-raised border border-border rounded-lg px-2.5 py-1.5">
          <Search size={12} className="text-foreground-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={type === "gif" ? "Search GIFs…" : "Search stickers…"}
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-foreground-muted outline-none font-body min-w-0"
          />
          {query && (
            <button onClick={() => { onQueryChange(""); inputRef.current?.focus(); }}
              className="shrink-0 text-foreground-muted hover:text-foreground transition-colors" aria-label="Clear">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-2 pb-1">
        {loading && results.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-4 h-4 border-2 border-border border-t-foreground-muted rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-1">
            <p className="text-xs text-foreground-muted">No results</p>
          </div>
        ) : (
          <div className="columns-2 gap-1 space-y-1">
            {results.map((gif) => (
              <div key={gif.id} onClick={() => onSelect(gif.sendUrl)} title={gif.title}
                className="break-inside-avoid cursor-pointer rounded-md overflow-hidden
                  ring-1 ring-transparent hover:ring-accent/50 active:scale-95 transition-all duration-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={gif.previewUrl} alt={gif.title} loading="lazy"
                  className="w-full h-auto block bg-surface-raised" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-2.5 py-1 flex justify-end border-t border-border">
        <span className="text-[9px] text-foreground-muted/40 font-mono">GIPHY</span>
      </div>
    </div>
  );
}

// ─── CSS var overrides so emoji-picker-react uses our design tokens ───────────

const EPR_VARS: React.CSSProperties = {
  ["--epr-bg-color" as string]:                  "var(--color-surface)",
  ["--epr-category-label-bg-color" as string]:   "var(--color-surface)",
  ["--epr-text-color" as string]:                "var(--color-foreground)",
  ["--epr-search-input-bg-color" as string]:     "var(--color-surface-raised)",
  ["--epr-search-border-color" as string]:       "var(--color-border)",
  ["--epr-hover-bg-color" as string]:            "var(--color-surface-raised)",
  ["--epr-focus-bg-color" as string]:            "var(--color-surface-raised)",
  ["--epr-highlight-color" as string]:           "var(--color-accent)",
  ["--epr-category-icon-active-color" as string]:"var(--color-accent)",
  ["--epr-emoji-size" as string]:                "22px",
  ["--epr-emoji-gap" as string]:                 "3px",
  ["--epr-header-padding" as string]:            "4px 8px",
  ["--epr-search-input-height" as string]:       "30px",
  ["--epr-category-label-height" as string]:     "22px",
  width:  "100%",
  height: "100%",
};

// ─── Main picker ──────────────────────────────────────────────────────────────

export function EmojiGifPicker({ onEmojiSelect, onGifSelect }: EmojiGifPickerProps) {
  const [tab, setTab] = useState<Tab>("emoji");

  return (
    <div
      className="flex flex-col bg-surface border border-border rounded-xl overflow-hidden shadow-md"
      style={{ height: 440, width: 340 }}
    >
      {/* ── Content ── */}
      <div className="flex-1 min-h-0">
        {tab === "emoji" && (
          <div style={EPR_VARS}>
            <EmojiPickerReact
              onEmojiClick={(d: EmojiClickData) => onEmojiSelect(d.emoji)}
              theme={Theme.DARK}
              searchPlaceholder="Search emoji…"
              width="100%"
              height="100%"
              previewConfig={{ showPreview: false }}
              lazyLoadEmojis
              skinTonesDisabled
            />
          </div>
        )}
        {tab === "gif"     && <GifGrid type="gif"     onSelect={onGifSelect} />}
        {tab === "sticker" && <GifGrid type="sticker" onSelect={onGifSelect} />}
      </div>

      {/* ── Tab bar — bottom ── */}
      <div className="flex shrink-0 border-t border-border bg-surface">
        {([ 
          { id: "emoji"   as Tab, label: "Emoji",   icon: "😊" },
          { id: "gif"     as Tab, label: "GIF",     icon: null },
          { id: "sticker" as Tab, label: "Sticker", icon: "🎭" },
        ]).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2
                font-body transition-colors duration-150
                ${active ? "text-accent" : "text-foreground-muted hover:text-foreground"}`}
            >
              {active && (
                <span className="absolute top-0 left-4 right-4 h-[2px] rounded-full bg-accent" />
              )}

              {/* Icon row */}
              {t.id === "gif" ? (
                <span className={`text-[11px] font-black tracking-wide leading-none
                  ${active ? "text-accent" : "text-foreground-muted"}`}>
                  GIF
                </span>
              ) : (
                <span className="text-[14px] leading-none">{t.icon}</span>
              )}

              {/* Label — hidden for GIF since the icon is already the label */}
              {t.id !== "gif" && (
                <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">
                  {t.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
