"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached } from "@/lib/request-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import type { DmPerson } from "@/lib/direct-messages/types";

const DEBOUNCE_MS = 180;
const MIN_QUERY_CHARS = 2;

/**
 * Member picker for starting a conversation: type a name, pick the person,
 * and the thread opens (the conversation row is created on pick — see the
 * conversations POST route).
 */
export function DmNewMessageDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (person: DmPerson) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DmPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  // Reset on open; focus the input once the modal has mounted.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSearching(false);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++requestSeqRef.current;
    const timer = window.setTimeout(() => {
      void fetchJsonCached<{ people?: DmPerson[] }>(dmUrls.people(trimmed), { staleMs: 30_000 })
        .then((data) => {
          if (requestSeqRef.current !== seq) return;
          setResults(data.people ?? []);
        })
        .catch(() => {
          if (requestSeqRef.current !== seq) return;
          setResults([]);
        })
        .finally(() => {
          if (requestSeqRef.current === seq) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md" panelClassName="p-0 overflow-hidden">
      <div className="border-b border-border px-5 pt-5 pb-3">
        <h2 className="font-body text-base font-semibold text-foreground">New message</h2>
      </div>

      <div className="px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl bg-surface-raised px-3 py-2">
          <Search size={14} strokeWidth={2.5} className="shrink-0 text-foreground-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            className="min-w-0 flex-1 bg-transparent font-body text-sm text-foreground outline-none placeholder:text-foreground-muted"
            aria-label="Search people"
          />
          {searching && <Spinner size={14} />}
        </div>
      </div>

      <div className="max-h-[320px] min-h-[160px] overflow-y-auto pb-3">
        {query.trim().length < MIN_QUERY_CHARS ? (
          <p className="px-5 py-6 text-center font-body text-xs text-foreground-muted">
            Type at least {MIN_QUERY_CHARS} characters to search.
          </p>
        ) : results.length === 0 && !searching ? (
          <p className="px-5 py-6 text-center font-body text-xs text-foreground-muted">
            No members found.
          </p>
        ) : (
          results.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onPick(person)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-raised"
            >
              <AvatarImg url={person.avatar_url} name={person.name} size={36} className="shrink-0" />
              <span className="min-w-0 truncate font-body text-sm text-foreground">{person.name}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
