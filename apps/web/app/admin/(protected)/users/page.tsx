"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarThumb } from "@/components/admin/users/AvatarThumb";

interface UserProfile {
  avatar_url?: string | null;
  companies: { name: string } | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  is_blocked: boolean;
  created_at: string;
  designer_profiles: UserProfile | null;
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Users</h1>
          <p className="font-body text-xs text-foreground-muted mt-0.5">
            {total} registered accounts
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
          className="w-full rounded-md border border-border bg-surface pl-8 pr-8 py-1.5 font-body text-xs text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent focus:ring-1 focus:ring-accent/20"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden mb-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4 text-foreground-muted" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-12 text-center font-body text-xs text-foreground-muted">
            No users found.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Name", "Email", "Company", "Joined", "Status", "Actions"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 font-body text-[10px] font-medium text-foreground-muted uppercase tracking-wider ${
                      i === 5 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user, idx) => (
                <tr
                  key={user.id}
                  className={`${
                    idx < users.length - 1 ? "border-b border-white/5" : ""
                  } hover:bg-surface-raised transition-colors`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <AvatarThumb
                        url={user.designer_profiles?.avatar_url}
                        name={user.name}
                      />
                      <p
                        className={`font-body text-xs font-medium ${
                          user.is_blocked
                            ? "text-foreground-muted line-through"
                            : "text-foreground"
                        }`}
                      >
                        {user.name}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs text-foreground-muted">{user.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-body text-xs text-foreground-muted">
                      {user.designer_profiles?.companies?.name ?? "—"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-[10px] text-foreground-muted whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        user.is_blocked
                          ? "bg-red-500/10 text-red-400"
                          : "bg-green-500/10 text-green-400"
                      }`}
                    >
                      {user.is_blocked ? "Blocked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      className="rounded-md border border-border px-2.5 py-1 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
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

      {/* Row count */}
      {!loading && total > 0 && (
        <p className="mb-2 text-right font-body text-[10px] text-foreground-muted">
          {total} user{total !== 1 ? "s" : ""}
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
              <ChevronLeft size={13} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 font-body text-xs text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
