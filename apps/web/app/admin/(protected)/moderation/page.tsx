"use client";
import { Button } from "@/components/ui/shadcn/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/shadcn/table";


import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldAlert, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

type Status = "approved" | "review" | "rejected";

interface ModerationEvent {
  id: string;
  user_id: string | null;
  content_type: string;
  content_ref_id: string | null;
  status: Status;
  reason: string | null;
  provider: string;
  confidence: number;
  triggered_rules: Array<{ rule: string; category: string; action: string; confidence: number; detail?: string }>;
  duration_ms: number;
  moderator_notes: string | null;
  created_at: string;
  users: { name: string; email: string } | null;
}

const TABS: Array<{ label: string; value: Status }> = [
  { label: "Review Queue", value: "review" },
  { label: "Rejected", value: "rejected" },
  { label: "Approved", value: "approved" },
];

export default function ModerationPage() {
  const [events, setEvents] = useState<ModerationEvent[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ approved: 0, review: 0, rejected: 0 });
  const [status, setStatus] = useState<Status>("review");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/moderation?status=${status}&page=${page}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setCounts(data.counts ?? { approved: 0, review: 0, rejected: 0 });
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchEvents();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchEvents]);

  function selectStatus(nextStatus: Status) {
    setStatus(nextStatus);
    setPage(1);
  }

  async function updateEvent(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/moderation/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await fetchEvents();
  }

  async function deleteEvent(id: string) {
    await fetch(`/api/admin/moderation/${id}`, { method: "DELETE" });
    await fetchEvents();
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Moderation</h1>
          <p className="font-body text-xs text-muted-foreground mt-0.5">
            Review flagged content and user safety actions
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {TABS.map((tab) => (
          <Button variant="ghost"
            key={tab.value}
            onClick={() => selectStatus(tab.value)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              status === tab.value
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-popover"
            }`}
          >
            <p className="font-body text-xs text-muted-foreground">{tab.label}</p>
            <p className="mt-1 font-mono text-2xl text-foreground">{counts[tab.value]}</p>
          </Button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-5 w-5" />
          </div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-body text-sm text-muted-foreground">No moderation events found.</p>
          </div>
        ) : (
          <Table className="w-full">
            <TableHeader>
              <TableRow className="border-b border-border bg-popover">
                {["Content", "User", "Decision", "Rules", "Time", "Actions"].map((heading, index) => (
                  <TableHead key={heading} className={`px-4 py-2.5 font-body text-[11px] font-medium text-muted-foreground ${index === 5 ? "text-right" : "text-left"}`}>
                    {heading}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event, index) => (
                <TableRow key={event.id} className={`${index < events.length - 1 ? "border-b border-border" : ""} align-top`}>
                  <TableCell className="px-4 py-3">
                    <p className="font-body text-xs font-medium text-foreground">{event.content_type.replaceAll("_", " ")}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{event.content_ref_id ?? event.id}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <p className="font-body text-xs text-foreground">{event.users?.name ?? "Unknown"}</p>
                    <p className="font-body text-[11px] text-muted-foreground">{event.users?.email ?? "No account"}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] ${
                      event.status === "approved" ? "bg-green-500/10 text-green-400" : event.status === "review" ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"
                    }`}>
                      {event.status}
                    </span>
                    <p className="mt-1 font-body text-[11px] text-muted-foreground">{event.reason || "No reason"}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{event.provider} · {Math.round(event.confidence * 100)}%</p>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex max-w-sm flex-wrap gap-1">
                      {(event.triggered_rules ?? []).slice(0, 4).map((rule, ruleIndex) => (
                        <span key={`${event.id}-${ruleIndex}`} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {rule.category}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <p className="font-mono text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{event.duration_ms} ms</p>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {event.status !== "approved" && (
                        <Button variant="outline" onClick={() => updateEvent(event.id, { status: "approved" })} className="px-2 py-1">
                          Approve
                        </Button>
                      )}
                      {event.status !== "rejected" && (
                        <Button variant="outline" onClick={() => updateEvent(event.id, { status: "rejected" })} className="px-2 py-1">
                          Reject
                        </Button>
                      )}
                      {event.user_id && (
                        <Button variant="outline" title="Permanent ban" onClick={() => updateEvent(event.id, { ban_user: true, moderator_notes: "Permanent ban from moderation queue." })} className="p-1.5">
                          <ShieldAlert strokeWidth={2.5} size={14} />
                        </Button>
                      )}
                      <Button variant="outline" title="Delete event" onClick={() => deleteEvent(event.id)} className="p-1.5">
                        <Trash2 strokeWidth={2.5} size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-body text-xs text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-1.5">
            <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="flex items-center gap-1 px-2.5 py-1.5 disabled:opacity-40">
              <ChevronLeft strokeWidth={2.5} size={13} /> Prev
            </Button>
            <Button variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="flex items-center gap-1 px-2.5 py-1.5 disabled:opacity-40">
              Next <ChevronRight strokeWidth={2.5} size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
