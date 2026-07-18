"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

interface Profile {
  id: string;
  experience_level: string;
  companies: { name: string } | null;
  cities: { name: string } | null;
  design_sectors: { name: string } | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  is_blocked: boolean;
  created_at: string;
  designer_profiles: Profile | null;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const PAGE_SIZE = 25;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), search });
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const inputClass =
    "rounded-md border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent/20";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Users</h1>
          <p className="font-body text-sm text-foreground-muted mt-0.5">{total} registered accounts</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className={`${inputClass} pl-9 w-full`}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden mb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5 text-foreground-muted" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-16 text-center font-body text-sm text-foreground-muted">No users found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Email</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Company</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Joined</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, idx) => (
                <tr
                  key={user.id}
                  className={`${idx < users.length - 1 ? "border-b border-white/5" : ""} hover:bg-surface-raised transition-colors`}
                >
                  <td className="px-5 py-3.5">
                    <p className={`font-body text-sm font-medium ${user.is_blocked ? "text-foreground-muted line-through" : "text-foreground"}`}>
                      {user.name}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm text-foreground-muted">{user.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm text-foreground-muted">
                      {user.designer_profiles?.companies?.name ?? "—"}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-mono text-[11px] text-foreground-muted whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${
                      user.is_blocked
                        ? "bg-red-500/10 text-red-400"
                        : "bg-green-500/10 text-green-400"
                    }`}>
                      {user.is_blocked ? "Blocked" : "Active"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      className="rounded-md border border-border px-3 py-1 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-sm text-foreground-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 font-body text-sm text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 font-body text-sm text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
