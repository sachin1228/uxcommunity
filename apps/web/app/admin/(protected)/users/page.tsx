"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Trash2, ShieldOff, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
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
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

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

  async function handleBlock(user: User) {
    setActionLoading(user.id + "-block");
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_blocked: !user.is_blocked }),
      });
      fetchUsers();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(user: User) {
    setActionLoading(user.id + "-delete");
    try {
      await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      setConfirmDelete(null);
      fetchUsers();
    } finally {
      setActionLoading(null);
    }
  }

  const inputClass =
    "rounded-md border border-overlay-elevated bg-overlay px-3 py-2 font-body text-sm text-overlay-foreground outline-none transition-colors placeholder:text-overlay-muted focus:border-accent focus:ring-1 focus:ring-accent/20";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-overlay-foreground">Users</h1>
          <p className="font-body text-sm text-overlay-muted mt-0.5">{total} registered accounts</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-overlay-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className={`${inputClass} pl-9 w-full`}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-overlay-elevated bg-overlay-raised overflow-hidden mb-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5 text-overlay-muted" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-16 text-center font-body text-sm text-overlay-muted">No users found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-overlay-elevated">
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Email</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Company</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Joined</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right font-body text-xs font-medium text-overlay-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, idx) => (
                <tr
                  key={user.id}
                  className={`${idx < users.length - 1 ? "border-b border-white/5" : ""} hover:bg-overlay-elevated/30 transition-colors`}
                >
                  <td className="px-5 py-3.5">
                    <p className={`font-body text-sm font-medium ${user.is_blocked ? "text-overlay-muted line-through" : "text-overlay-foreground"}`}>
                      {user.name}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm text-overlay-muted">{user.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-body text-sm text-overlay-muted">
                      {user.designer_profiles?.companies?.name ?? "—"}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="font-mono text-[11px] text-overlay-muted whitespace-nowrap">
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
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-3">
                      {/* Block / Unblock */}
                      <button
                        onClick={() => handleBlock(user)}
                        disabled={!!actionLoading}
                        title={user.is_blocked ? "Unblock user" : "Block user"}
                        className={`transition-colors disabled:opacity-40 ${
                          user.is_blocked
                            ? "text-green-500 hover:text-green-400"
                            : "text-overlay-muted hover:text-red-400"
                        }`}
                      >
                        {actionLoading === user.id + "-block"
                          ? <Spinner className="h-4 w-4" />
                          : user.is_blocked
                            ? <ShieldCheck size={16} />
                            : <ShieldOff size={16} />
                        }
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => setConfirmDelete(user)}
                        disabled={!!actionLoading}
                        title="Delete user"
                        className="text-overlay-muted hover:text-red-400 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === user.id + "-delete"
                          ? <Spinner className="h-4 w-4" />
                          : <Trash2 size={15} />
                        }
                      </button>
                    </div>
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
          <p className="font-body text-sm text-overlay-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-md border border-overlay-elevated px-3 py-1.5 font-body text-sm text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-md border border-overlay-elevated px-3 py-1.5 font-body text-sm text-overlay-muted hover:text-overlay-foreground hover:bg-overlay-elevated transition-colors disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-overlay-elevated bg-overlay-raised p-6 shadow-xl">
            <h2 className="font-display text-lg font-semibold text-overlay-foreground mb-1">
              Delete account?
            </h2>
            <p className="font-body text-sm text-overlay-muted mb-6">
              This will permanently remove{" "}
              <span className="text-overlay-foreground font-medium">{confirmDelete.name}</span>{" "}
              ({confirmDelete.email}) and all their data. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-md border border-overlay-elevated py-2 font-body text-sm text-overlay-muted hover:bg-overlay-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={!!actionLoading}
                className="flex-1 flex items-center justify-center gap-2 rounded-md bg-red-600 py-2 font-body text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {actionLoading === confirmDelete.id + "-delete"
                  ? <Spinner className="h-4 w-4" />
                  : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
