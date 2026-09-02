"use client";

import { Spinner } from "@/components/ui/Spinner";
import { Check, ExternalLink, Globe2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = (id: string) => `custom-url-${id}`;

export function CustomView({ communityId }: { communityId: string; currentUserId: string }) {
  const [url, setUrl] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY(communityId));
    if (stored) {
      setUrl(stored);
      setInputValue(stored);
    }
  }, [communityId]);

  const handleSave = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY(communityId), trimmed);
    setUrl(trimmed);
    setSaved(true);
    setLoading(true);
    setTimeout(() => setSaved(false), 1500);
  }, [communityId, inputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSave();
    },
    [handleSave],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 px-5 py-3 border-b border-border flex items-center gap-3">
        <Globe2 size={15} className="text-foreground-muted shrink-0" />
        <input
          type="url"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter project URL (e.g. https://example.com)"
          className="flex-1 bg-surface-raised border border-border rounded-lg px-3 py-1.5 font-body text-xs text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={handleSave}
          className="shrink-0 h-7 px-3 rounded-lg bg-accent/10 border border-accent/20 font-body text-xs font-medium text-accent hover:bg-accent/20 transition-colors flex items-center gap-1.5"
        >
          {saved ? <Check size={12} /> : <ExternalLink size={12} />}
          {saved ? "Loaded" : "Load"}
        </button>
      </div>

      {!url ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="font-body text-sm text-foreground-muted">Enter a URL above to load a project.</p>
        </div>
      ) : (
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <Spinner size={28} />
            </div>
          )}
          <iframe
            src={url}
            title="Custom Project"
            className={`absolute inset-0 w-full h-full border-0 ${loading ? "invisible" : ""}`}
            onLoad={() => setLoading(false)}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </div>
      )}
    </div>
  );
}
