"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, X, Mail } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface SignupAttempt {
  id: string;
  email: string;
  name: string | null;
  flow: "direct" | "invitation";
  application_id: string | null;
  started_at: string;
}

const FLOW_LABELS: Record<string, string> = {
  direct: "Direct",
  invitation: "Invited",
};

export default function IncompleteSignupsPage() {
  const [attempts, setAttempts] = useState<SignupAttempt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const PAGE_SIZE = 25;

  const fetchAttempts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), search });
      const res = await fetch(`/api/admin/signup-attempts?${params}`);
      const data = await res.json();
      setAttempts(data.attempts ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchAttempts(); }, [fetchAttempts]);
  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">
            Incomplete Signups
          </h1>
          <p className="font-body text-xs text-foreground-muted mt-0.5">
            {total} {total === 1 ? "person" : "people"} entered their email but never finished signing up
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3 max-w-xs">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="field w-full pl-8 pr-8"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
          >
            <X strokeWidth={2.5} size={12} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden mb-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : attempts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2">
            <p className="font-body text-sm text-foreground-muted">
              No incomplete signups{search ? " match your search" : ""}.
            </p>
            {!search && (
              <p className="font-body text-xs text-foreground-subtle">
                Everyone who started has finished — nice.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Email", "Entry", "Started", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider ${
                      i === 4 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt, idx) => (
                <tr
                  key={attempt.id}
                  className={`${
                    idx < attempts.length - 1 ? "border-b border-border-subtle" : ""
                  } hover:bg-surface-raised transition-colors`}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs font-medium text-foreground">
                      {attempt.name?.trim() || "—"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs text-foreground-muted">{attempt.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        attempt.flow === "invitation"
                          ? "bg-purple-500/10 text-purple-400"
                          : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {FLOW_LABELS[attempt.flow] ?? attempt.flow}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-[10px] text-foreground-muted whitespace-nowrap">
                      {new Date(attempt.started_at).toLocaleString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`mailto:${attempt.email}?subject=${encodeURIComponent(
                        "Finish setting up your UX Community account"
                      )}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
                    >
                      <Mail strokeWidth={2.5} size={12} /> Email
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Row count */}
      {!loading && total > 0 && (
        <p className="mb-2 text-right font-body text-[10px] text-foreground-muted">
          {total} {total !== 1 ? "people" : "person"}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-foreground-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              <ChevronLeft strokeWidth={2.5} size={13} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              Next <ChevronRight strokeWidth={2.5} size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
