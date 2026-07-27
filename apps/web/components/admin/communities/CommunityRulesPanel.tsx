"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Check, X, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

interface Rule {
  id: string;
  rule_text: string;
  order_index: number;
  created_at: string;
}

interface CommunityRulesPanelProps {
  communityId: string;
}

export function CommunityRulesPanel({ communityId }: CommunityRulesPanelProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add rule state
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit rule state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/communities/${communityId}/rules`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.rules) setRules(d.rules); })
      .catch(() => setError("Failed to load rules."))
      .finally(() => setLoading(false));
  }, [communityId]);

  async function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_text: text }),
      });
      const d = await res.json();
      if (!res.ok) { setAddError(d.error ?? "Failed to add rule."); return; }
      setRules((prev) => [...prev, d.rule]);
      setNewText("");
      setAdding(false);
    } catch { setAddError("Network error."); }
    finally { setAddLoading(false); }
  }

  async function handleEditSave(id: string) {
    const text = editText.trim();
    if (!text) { setEditError("Rule cannot be empty."); return; }
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_text: text }),
      });
      const d = await res.json();
      if (!res.ok) { setEditError(d.error ?? "Failed to update."); return; }
      setRules((prev) => prev.map((r) => r.id === id ? d.rule : r));
      setEditingId(null);
    } catch { setEditError("Network error."); }
    finally { setEditLoading(false); }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/communities/${communityId}/rules/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch { /* silent */ }
    finally { setDeletingId(null); }
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rules.length) return;

    const ruleA = rules[idx];
    const ruleB = rules[swapIdx];

    // Optimistic update: swap their order_index values
    const next = rules.map((r) => {
      if (r.id === ruleA.id) return { ...r, order_index: ruleB.order_index };
      if (r.id === ruleB.id) return { ...r, order_index: ruleA.order_index };
      return r;
    });
    next.sort((a, b) => a.order_index - b.order_index);
    setRules(next);

    // Persist both swaps in parallel
    await Promise.all([
      fetch(`/api/admin/communities/${communityId}/rules/${ruleA.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_index: ruleB.order_index }),
      }),
      fetch(`/api/admin/communities/${communityId}/rules/${ruleB.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_index: ruleA.order_index }),
      }),
    ]);
  }

  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-body text-sm font-semibold text-foreground">Community Rules</h2>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setNewText(""); setAddError(null); }}
            className="flex items-center gap-1 font-body text-xs text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={13} /> Add rule
          </button>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner className="h-4 w-4 text-foreground-muted" />
        </div>
      )}

      {error && (
        <p className="font-body text-xs text-red-400">{error}</p>
      )}

      {!loading && rules.length === 0 && !adding && (
        <p className="font-body text-xs text-foreground-muted">
          No rules yet. Add the first one.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {rules.map((rule, i) => (
          <li key={rule.id} className="flex items-start gap-2 group">
            {/* Order number */}
            <span className="mt-0.5 shrink-0 w-5 font-mono text-[11px] text-foreground-muted text-right select-none">
              {i + 1}.
            </span>

            {editingId === rule.id ? (
              <div className="flex-1 flex flex-col gap-1">
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-surface-raised px-2 py-1 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none"
                />
                {editError && <p className="font-body text-[11px] text-red-400">{editError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditSave(rule.id)}
                    disabled={editLoading}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {editLoading ? <Spinner className="h-3 w-3" /> : <Check size={11} />} Save
                  </button>
                  <button
                    onClick={() => { setEditingId(null); setEditError(null); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-foreground-muted hover:text-foreground transition-colors"
                  >
                    <X size={11} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="flex-1 font-body text-xs text-foreground leading-relaxed">
                  {rule.rule_text}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => handleMove(rule.id, "up")}
                    disabled={i === 0}
                    className="p-0.5 text-foreground-muted hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    title="Move up"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => handleMove(rule.id, "down")}
                    disabled={i === rules.length - 1}
                    className="p-0.5 text-foreground-muted hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                    title="Move down"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    onClick={() => { setEditText(rule.rule_text); setEditingId(rule.id); setEditError(null); }}
                    className="p-0.5 text-foreground-muted hover:text-foreground transition-colors"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={deletingId === rule.id}
                    className="p-0.5 text-foreground-muted hover:text-red-400 disabled:opacity-50 transition-colors"
                    title="Delete"
                  >
                    {deletingId === rule.id ? <Spinner className="h-3 w-3" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>

      {/* Add new rule inline */}
      {adding && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <textarea
            autoFocus
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); }
              if (e.key === "Escape") { setAdding(false); setAddError(null); }
            }}
            placeholder="Describe the rule…"
            rows={2}
            maxLength={500}
            className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 font-body text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none placeholder:text-foreground-muted"
          />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-foreground-muted">{newText.length}/500</span>
            {addError && <p className="font-body text-[11px] text-red-400">{addError}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addLoading || !newText.trim()}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {addLoading ? <Spinner className="h-3 w-3" /> : <Plus size={11} />} Add rule
            </button>
            <button
              onClick={() => { setAdding(false); setAddError(null); setNewText(""); }}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-foreground-muted hover:text-foreground transition-colors"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
