"use client";
import { Input } from "@/components/ui/shadcn/input";
import { Button } from "@/components/ui/shadcn/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/shadcn/table";


import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { AvatarThumb } from "@/components/admin/users/AvatarThumb";

interface UserProfile {
  avatar_url?: string | null;
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
          <p className="font-body text-xs text-muted-foreground mt-0.5">
            {total} registered accounts
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3 max-w-xs">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="w-full pl-8 pr-8"
        />
        {search && (
          <Button variant="ghost"
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2"
          >
            <X strokeWidth={2.5} size={12} />
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden mb-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-4 w-4" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-12 text-center font-body text-xs text-muted-foreground">
            No users found.
          </p>
        ) : (
          <Table className="w-full">
            <TableHeader>
              <TableRow className="border-b border-border">
                {["Name", "Email", "Joined", "Status", "Actions"].map((h, i) => (
                  <TableHead
                    key={h}
                    className={`px-4 py-2.5 font-body text-[10px] font-medium text-muted-foreground uppercase tracking-wider ${
                      i === 4 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user, idx) => (
                <TableRow
                  key={user.id}
                  className={`${
                    idx < users.length - 1 ? "border-b border-border" : ""
                  } hover:bg-popover transition-colors`}
                >
                  <TableCell className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <AvatarThumb
                        url={user.designer_profiles?.avatar_url}
                        name={user.name}
                      />
                      <p
                        className={`font-body text-xs font-medium ${
                          user.is_blocked
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }`}
                      >
                        {user.name}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <p className="font-body text-xs text-muted-foreground">{user.email}</p>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <p className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </p>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        user.is_blocked
                          ? "bg-red-500/10 text-red-400"
                          : "bg-green-500/10 text-green-400"
                      }`}
                    >
                      {user.is_blocked ? "Blocked" : "Active"}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right">
                    <Button variant="outline"
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      className="px-2.5 py-1 transition-colors"
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Row count */}
      {!loading && total > 0 && (
        <p className="mb-2 text-right font-body text-[10px] text-muted-foreground">
          {total} user{total !== 1 ? "s" : ""}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-2.5 py-1.5 transition-colors disabled:opacity-40"
            >
              <ChevronLeft strokeWidth={2.5} size={13} /> Prev
            </Button>
            <Button variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-2.5 py-1.5 transition-colors disabled:opacity-40"
            >
              Next <ChevronRight strokeWidth={2.5} size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
