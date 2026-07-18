"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Plus, ToggleLeft, ToggleRight, Check, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export interface MasterItem {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

interface MasterDataPageProps {
  title: string;
  /** e.g. "company", "city", "sector" */
  entity: string;
  apiBase: string; // e.g. /api/admin/companies
}

export function MasterDataPage({ title, entity, apiBase }: MasterDataPageProps) {
  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(true);

  const [addName, setAddName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}?all=${showAll}`);
      const data = await res.json();
      // The key differs per entity type — try all possible keys
      const rows: MasterItem[] =
        data.companies ?? data.cities ?? data.sectors ?? [];
      setItems(rows);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [apiBase, showAll]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add.");
        return;
      }
      setAddName("");
      load();
    } catch {
      setAddError("Network error.");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEditSave(id: string) {
    setEditLoading(true);
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      if (res.ok) {
        setEditingId(null);
        load();
      }
    } finally {
      setEditLoading(false);
    }
  }

  async function handleToggle(item: MasterItem) {
    await fetch(`${apiBase}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !item.is_active }),
    });
    load();
  }

  const inputClass =
    "rounded-md border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {title}
        </h1>
        <label className="flex items-center gap-2 font-body text-sm text-foreground-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="accent-accent"
          />
          Show inactive
        </label>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mb-6 flex gap-3">
        <input
          type="text"
          value={addName}
          onChange={(e) => { setAddName(e.target.value); setAddError(null); }}
          placeholder={`New ${entity} name`}
          className={`${inputClass} flex-1`}
          required
        />
        <button
          type="submit"
          disabled={addLoading}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-body text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {addLoading ? <Spinner className="h-4 w-4 text-white" /> : <Plus size={16} />}
          Add
        </button>
      </form>
      {addError && (
        <p className="mb-4 font-body text-sm text-red-400">{addError}</p>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-5 w-5 text-foreground-muted" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center font-body text-sm text-foreground-muted">
            No {entity.toLowerCase()}s yet.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-right font-body text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.id}
                  className={`${idx < items.length - 1 ? "border-b border-white/5" : ""} hover:bg-surface-raised transition-colors`}
                >
                  <td className="px-5 py-3.5">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className={`${inputClass} flex-1`}
                          autoFocus
                        />
                        <button
                          onClick={() => handleEditSave(item.id)}
                          disabled={editLoading}
                          className="text-green-400 hover:text-green-300 transition-colors"
                          aria-label="Save"
                        >
                          {editLoading ? <Spinner className="h-4 w-4" /> : <Check size={16} />}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-foreground-muted hover:text-foreground transition-colors"
                          aria-label="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <span className={`font-body text-sm ${item.is_active ? "text-foreground" : "text-foreground-muted line-through"}`}>
                        {item.name}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ${item.is_active ? "bg-green-500/10 text-green-400" : "bg-surface-raised text-foreground-muted"}`}>
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-3">
                      {editingId !== item.id && (
                        <button
                          onClick={() => { setEditingId(item.id); setEditName(item.name); }}
                          className="text-foreground-muted hover:text-foreground transition-colors"
                          aria-label="Edit"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggle(item)}
                        className={`transition-colors ${item.is_active ? "text-foreground-muted hover:text-red-400" : "text-foreground-muted hover:text-green-400"}`}
                        aria-label={item.is_active ? "Deactivate" : "Activate"}
                        title={item.is_active ? "Deactivate" : "Activate"}
                      >
                        {item.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
