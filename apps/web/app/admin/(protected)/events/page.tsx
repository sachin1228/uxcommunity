"use client";

// The events moderation queue: one row per event — the host, the community
// that ran it, its group chat, the RSVP count and the lifecycle — so an admin
// can spot and remove fake or spam events. Filters (status, search) ride the
// query string to /api/admin/events.
//
// Rows expand in place to the full description and facts (with the cover);
// Delete is the one action and it names its consequences first — the event
// and everything on it go, while its group chat stays with its members.

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Search,
  Trash2,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ModalPortal } from "@/components/ui/Modal";
import { ModalError } from "@/components/ui/ModalError";

type EventState = "upcoming" | "live" | "ended";
type StatusFilter = EventState | "all";

interface AdminEventRow {
  id: string;
  title: string;
  description: string | null;
  state: EventState;
  event_date: string;
  end_date: string | null;
  is_online: boolean;
  is_public: boolean;
  location: string | null;
  meet_link: string | null;
  max_attendees: number | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  city_name: string | null;
  host: { id: string; name: string | null; email: string | null } | null;
  community: string;
  room: { id: string; name: string; member_count: number } | null;
  rsvp_count: number;
}

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
];

const PAGE_SIZE = 25;

/**
 * The lifecycle pill, in the app's own event vocabulary: LIVE wears the red
 * pill with the pulsing dot (the same mark the event rooms wear in the
 * sidebar), ENDED is the quiet word for a window that closed, and UPCOMING
 * sits between them.
 */
function StateBadge({ state }: { state: EventState }) {
  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-red-700)] px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-white">
        <span aria-hidden="true" className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-full w-full rounded-full bg-white" />
        </span>
        Live
      </span>
    );
  }
  if (state === "ended") {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
        Ended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-raised px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
      Upcoming
    </span>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<StatusFilter, number>>({
    all: 0,
    upcoming: 0,
    live: 0,
    ended: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmEvent, setConfirmEvent] = useState<AdminEventRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Typing settles before the request fires; every keystroke would otherwise
  // re-order and re-page the table under the admin's cursor.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), status: statusFilter });
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/events?${params}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setTotal(data.total ?? 0);
      const next = data.counts ?? { upcoming: 0, live: 0, ended: 0 };
      setCounts({
        upcoming: next.upcoming ?? 0,
        live: next.live ?? 0,
        ended: next.ended ?? 0,
        all: (next.upcoming ?? 0) + (next.live ?? 0) + (next.ended ?? 0),
      });
    } catch {
      // ignore — the table keeps its last good page
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchEvents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchEvents]);

  async function handleDelete() {
    if (!confirmEvent) return;
    setDeleteLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/events/${confirmEvent.id}`, { method: "DELETE" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Failed to delete the event.");
        return;
      }
      setConfirmEvent(null);
      await fetchEvents();
    } catch {
      setActionError("Failed to delete the event.");
    } finally {
      setDeleteLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Events</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {counts.upcoming} upcoming event{counts.upcoming === 1 ? "" : "s"} · {counts.live} live now
          </p>
        </div>
        <span className="font-mono text-xs text-foreground-muted">{total} total</span>
      </div>

      {/* Status tabs */}
      <div className="mb-3 flex gap-0.5 border-b border-border">
        {STATUS_TABS.map(({ value, label }) => {
          const isActive = statusFilter === value;
          return (
            <button
              key={value}
              onClick={() => {
                setLoading(true);
                setStatusFilter(value);
                setPage(1);
                setExpandedId(null);
              }}
              className={`-mb-px border-b-2 px-3.5 py-2 font-body text-xs font-medium transition-colors ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  isActive ? "bg-accent/15 text-accent" : "bg-surface-raised text-foreground-muted"
                }`}
              >
                {counts[value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search
            size={13}
            strokeWidth={2.5}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground-subtle"
          />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search title, host or community…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pr-2.5 pl-8 font-body text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
          />
        </div>
        {search && (
          <button
            onClick={() => {
              setLoading(true);
              setSearchInput("");
              setSearch("");
              setPage(1);
            }}
            className="rounded-md px-2 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Clear search
          </button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-body text-xs text-red-400">
          {actionError}
        </p>
      )}

      {/* Table */}
      <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : events.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarDays strokeWidth={2.5} size={20} className="mx-auto mb-2 text-foreground-muted opacity-50" />
            <p className="font-body text-xs text-foreground-muted">
              {statusFilter === "all" && !search ? "No events yet." : "Nothing here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem]">
              <thead>
                <tr className="border-b border-border">
                  {["Event", "Host", "Community", "When", "Attendees", "Status", ""].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-2.5 text-left font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => {
                  const expanded = expandedId === event.id;
                  const meta = [
                    event.is_online ? "Online" : "In person",
                    event.city_name,
                    event.is_public ? "Public" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Fragment key={event.id}>
                      <tr
                        className={`${index < events.length - 1 || expanded ? "border-b border-border-subtle" : ""} align-top transition-colors hover:bg-surface-raised`}
                      >
                        <td className="max-w-[18rem] px-4 py-3">
                          <p className="font-body text-xs font-medium text-foreground">
                            {event.title}
                          </p>
                          <p className="mt-0.5 truncate font-body text-[11px] text-foreground-muted">
                            {meta}
                          </p>
                        </td>
                        <td className="max-w-[14rem] px-4 py-3">
                          <p className="font-body text-xs text-foreground-muted">
                            {event.host?.name ?? "Unknown member"}
                          </p>
                          <p className="truncate font-body text-[11px] text-foreground-subtle">
                            {event.host?.email ?? ""}
                          </p>
                        </td>
                        <td className="max-w-[14rem] px-4 py-3">
                          <p className="truncate font-body text-xs text-foreground-muted">
                            {event.community}
                          </p>
                          <p className="font-body text-[11px] text-foreground-subtle">
                            {event.room
                              ? `Chat · ${event.room.member_count} member${event.room.member_count === 1 ? "" : "s"}`
                              : "No group chat"}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <p className="font-mono text-[10px] text-foreground-muted">
                            {formatDateTime(event.event_date)}
                          </p>
                          {event.end_date && (
                            <p className="font-mono text-[10px] text-foreground-subtle">
                              till {formatDateTime(event.end_date)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] text-foreground-muted">
                            {event.rsvp_count}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StateBadge state={event.state} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              onClick={() => setExpandedId(expanded ? null : event.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                            >
                              {expanded ? (
                                <ChevronDown strokeWidth={2.5} size={12} />
                              ) : (
                                <ChevronRight strokeWidth={2.5} size={12} />
                              )}
                              {expanded ? "Close" : "Open"}
                            </button>
                            <button
                              onClick={() => {
                                setActionError(null);
                                setConfirmEvent(event);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1 font-body text-xs text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              <Trash2 strokeWidth={2.5} size={12} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className={index < events.length - 1 ? "border-b border-border-subtle" : ""}>
                          <td colSpan={7} className="bg-background/40 px-4 py-3">
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Description
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap font-body text-xs leading-5 text-foreground">
                                  {event.description || "No description."}
                                </p>
                                {event.cover_image_url && (
                                  <img
                                    src={event.cover_image_url}
                                    alt=""
                                    className="mt-3 max-h-24 rounded-md border border-border"
                                  />
                                )}
                              </div>
                              <div>
                                <p className="font-body text-[10px] font-medium uppercase tracking-wider text-foreground-muted">
                                  Event facts
                                </p>
                                <dl className="mt-1.5 space-y-1">
                                  {[
                                    ["Community", event.community],
                                    ["City", event.city_name ?? "Not set"],
                                    ["Venue", event.is_online ? "Online" : (event.location ?? "Not set")],
                                    ["Capacity", event.max_attendees ? `${event.max_attendees} max` : "Unlimited"],
                                    [
                                      "Group chat",
                                      event.room
                                        ? `${event.room.name} · ${event.room.member_count} members`
                                        : "None",
                                    ],
                                    ["Visibility", event.is_public ? "Public — home feed and city pages" : "Community only"],
                                    ["Created", formatDateTime(event.created_at)],
                                    ["Updated", formatDateTime(event.updated_at)],
                                  ].map(([label, value]) => (
                                    <div key={label} className="flex items-baseline gap-2">
                                      <dt className="w-24 shrink-0 font-body text-[11px] text-foreground-subtle">
                                        {label}
                                      </dt>
                                      <dd className="min-w-0 font-body text-xs text-foreground">{value}</dd>
                                    </div>
                                  ))}
                                  {event.is_online && event.meet_link && (
                                    <div className="flex items-baseline gap-2">
                                      <dt className="w-24 shrink-0 font-body text-[11px] text-foreground-subtle">
                                        Meet link
                                      </dt>
                                      <dd className="min-w-0">
                                        <a
                                          href={event.meet_link}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="block truncate font-body text-xs text-accent hover:underline"
                                        >
                                          {event.meet_link}
                                        </a>
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-foreground-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Prev
            </button>
            <button
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.min(totalPages, current + 1));
              }}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmEvent && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="modal-panel w-full max-w-sm p-6">
              <h2 className="font-display text-base font-semibold text-foreground mb-1">
                Delete &ldquo;{confirmEvent.title}&rdquo;?
              </h2>
              <p className="font-body text-xs text-foreground-muted mb-5">
                This will permanently remove the event
                {confirmEvent.rsvp_count > 0 && (
                  <>
                    {" "}and its{" "}
                    <span className="text-foreground font-medium">
                      {confirmEvent.rsvp_count} RSVP{confirmEvent.rsvp_count === 1 ? "" : "s"}
                    </span>
                  </>
                )}
                {confirmEvent.room
                  ? " from every feed. Its group chat stays with its members. "
                  : " from every feed. "}
                The host is notified. Use this for fake or spam events. Cannot be undone.
              </p>
              {actionError && <ModalError className="mb-4">{actionError}</ModalError>}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmEvent(null);
                    setActionError(null);
                  }}
                  className="modal-btn modal-btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleteLoading}
                  className="modal-btn modal-btn-danger flex-1"
                >
                  {deleteLoading ? <Spinner className="h-3 w-3" /> : <Trash2 strokeWidth={2.5} size={12} />}
                  Yes, delete
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
