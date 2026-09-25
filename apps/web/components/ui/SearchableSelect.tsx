"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/** Roughly what the dropdown occupies (search row + the list's max height). */
const DROPDOWN_HEIGHT = 248;

/**
 * Whether the list would run past the bottom of whatever scrolls this trigger.
 * The forms that use this field are long, so a picker sitting near the bottom
 * edge would otherwise open into space the member cannot see; when there is
 * room above instead, the list opens upward.
 */
function opensUpward(node: HTMLElement | null): boolean {
  if (!node) return false;
  const trigger = node.getBoundingClientRect();
  let below = window.innerHeight - 8;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll|hidden)/.test(style.overflowY)) {
      below = Math.min(below, el.getBoundingClientRect().bottom - 8);
    }
  }
  return trigger.bottom + DROPDOWN_HEIGHT > below && trigger.top - DROPDOWN_HEIGHT > 8;
}

interface Option {
  value: string;
  label: string;
  imageUrl?: string | null;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** If true, an "Other" option is appended when there are no search results */
  allowOther?: boolean;
  otherValue?: string;
  otherLabel?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  allowOther = false,
  otherValue = "other",
  otherLabel = "Other",
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase())
      )
    : options;

  const showOther = allowOther && query.trim().length > 0 && filtered.length === 0;

  const selectedOption =
    value === otherValue && allowOther
      ? { label: otherLabel, imageUrl: null }
      : options.find((o) => o.value === value) ?? null;
  const selectedLabel = selectedOption?.label;

  const handleSelect = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Focus input when opened. preventScroll keeps a list opened upward from
  // yanking the form around as the field takes focus.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 10);
    }
  }, [open]);

  // Close on Escape
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  const triggerClass =
    "relative flex w-full cursor-pointer items-center justify-between rounded-md border border-border bg-surface px-3.5 py-2.5 font-body text-sm outline-none transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:cursor-not-allowed " +
    (open ? "border-accent ring-2 ring-accent/20 " : "") +
     (selectedLabel ? "text-foreground " : "text-foreground-muted ");

  return (
    <div ref={containerRef} className="relative w-full" onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        className={triggerClass}
        onClick={() => {
          if (disabled) return;
          const next = !open;
          if (next) setDropUp(opensUpward(containerRef.current));
          setOpen(next);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={selectedOption.imageUrl}
              alt=""
              className="h-5 w-5 shrink-0 rounded object-cover"
            />
          ) : selectedLabel ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-raised font-body text-[10px] font-semibold text-foreground-muted uppercase select-none">
              {selectedLabel[0]}
            </span>
          ) : null}
          <span className="truncate">{selectedLabel ?? placeholder}</span>
        </span>
        <svg
          className={
            "ml-2 h-4 w-4 flex-shrink-0 text-foreground-muted transition-transform duration-150 " +
            (open ? "rotate-180" : "")
          }
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={
            "absolute z-50 w-full rounded-md border border-border bg-surface-raised shadow-md overflow-hidden " +
            (dropUp ? "bottom-full mb-1" : "mt-1")
          }
        >
          {/* Search input */}
            <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <svg
                className="h-3.5 w-3.5 flex-shrink-0 text-foreground-muted"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                 className="w-full bg-transparent font-body text-sm text-foreground placeholder:text-foreground-subtle outline-none"
              />
            </div>
          </div>

          {/* Options list */}
          <ul
            role="listbox"
            className="max-h-52 overflow-y-auto py-1"
          >
            {filtered.map((option) => {
              const isSelected = value === option.value;
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                  className={
                    "flex cursor-pointer items-center gap-2.5 px-3.5 py-2 font-body text-sm transition-colors " +
                    (isSelected
                      ? "bg-accent/10 text-accent"
                       : "text-foreground hover:bg-background-subtle")
                  }
                >
                  {/* Image or letter avatar */}
                  {option.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={option.imageUrl}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded object-cover"
                    />
                  ) : (
                     <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface font-body text-[10px] font-semibold uppercase text-foreground-muted select-none">
                      {option.label[0]}
                    </span>
                  )}

                  <span className="flex-1 truncate">{option.label}</span>

                  {isSelected && (
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-accent"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </li>
              );
            })}

            {showOther && (
              <li
                role="option"
                aria-selected={value === otherValue}
                onClick={() => handleSelect(otherValue)}
                className={
                  "flex cursor-pointer items-center gap-2 px-3.5 py-2 font-body text-sm  transition-colors " +
                  (value === otherValue
                    ? "bg-accent/10 text-accent"
                     : "text-foreground-muted hover:bg-background-subtle")
                }
              >
                {value === otherValue ? (
                  <svg
                    className="h-3.5 w-3.5 flex-shrink-0 text-accent"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : null}
                <span className={value === otherValue ? "" : "ml-5.5"}>{otherLabel}</span>
              </li>
            )}

            {filtered.length === 0 && !showOther && (
               <li className="px-3.5 py-3 text-center font-body text-sm text-foreground-muted">
                No results found
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
