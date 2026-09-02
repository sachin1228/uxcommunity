"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, X } from "lucide-react";
import { fetchEmojiCatalog, type NotoEmoji } from "@/lib/noto-emoji";

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
            <div className="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin" />
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

// ─── Noto Animated Emoji Grid ────────────────────────────────────────────────

function NotoEmojiGrid({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const [emojis, setEmojis] = useState<NotoEmoji[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Load catalog on mount
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const catalog = await fetchEmojiCatalog();
        setEmojis(catalog.emojis);
        setCategories(catalog.categories);
        // Auto-select the first category (which is "Smileys and emotions")
        if (catalog.categories.length > 0) {
          setSelectedCategory(catalog.categories[0]);
        }
      } catch (error) {
        console.error("Failed to load emoji catalog:", error);
      } finally {
        setLoading(false);
      }
    };

    loadCatalog();
  }, []);

  // Filter emojis based on query and category
  const filteredEmojis = useMemo(() => {
    let filtered = emojis;
    
    // Filter by category if no search query and category is selected
    if (!query && selectedCategory) {
      filtered = filtered.filter(e => e.category === selectedCategory);
    }
    
    // Filter by search query
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(e => 
        e.name.toLowerCase().includes(lowerQuery) ||
        e.category.toLowerCase().includes(lowerQuery) ||
        e.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }
    
    return filtered;
  }, [emojis, query, selectedCategory]);

  const onQueryChange = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Debounced search - no additional action needed as filtering is done via useMemo
    }, 300);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-4 h-4 border-2 border-border border-t-accent rounded-full animate-spin" />
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
            placeholder="Search emoji…"
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

      {/* Category pills */}
      {!query && categories.length > 0 && (
        <div className="px-2 pb-1.5 shrink-0 overflow-x-auto">
          <div className="flex gap-1.5">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`whitespace-nowrap px-2 py-1 rounded-full text-[10px] font-medium transition-colors
                  ${selectedCategory === category
                    ? "bg-accent text-accent-foreground"
                    : "bg-surface-raised text-foreground-muted hover:text-foreground"
                  }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Emoji grid */}
      <div ref={gridRef} className="flex-1 overflow-y-auto px-2 pb-1">
        {filteredEmojis.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-1">
            <p className="text-xs text-foreground-muted">No emoji found</p>
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {filteredEmojis.map((emoji) => (
              <button
                key={emoji.codepoint}
                onClick={() => onSelect(emoji.unicode)}
                className="w-8 h-8 flex items-center justify-center rounded-md
                  hover:bg-surface-raised active:scale-90 transition-all duration-100"
                title={emoji.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={emoji.svgUrl}
                  alt={emoji.name}
                  className="w-6 h-6"
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to emoji character if SVG fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const span = document.createElement('span');
                    span.textContent = emoji.unicode;
                    span.className = 'text-xl';
                    target.parentElement?.appendChild(span);
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Branding */}
      <div className="shrink-0 px-2.5 py-1 flex justify-end border-t border-border">
        <span className="text-[9px] text-foreground-muted/40 font-mono">NOTO EMOJI</span>
      </div>
    </div>
  );
}

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
        {tab === "emoji" && <NotoEmojiGrid onSelect={onEmojiSelect} />}
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
