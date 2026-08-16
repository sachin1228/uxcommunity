"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Image as ImageIcon,
  MousePointer2,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import type { DuelChallenge, DuelComponent, DuelComponentType, DuelDesign } from "@/lib/design-duel/types";
import {
  componentBodyStyle,
  formatSeconds,
  makeComponent,
  renderDesignToCanvas,
  uid,
} from "@/lib/design-duel/design";
import { Spinner } from "@/components/ui/Spinner";
import { usePendingMutation } from "@/lib/use-mutation";

interface DuelEditorProps {
  challenge: DuelChallenge;
  submissionId: string;
  deadline: string;
  initialDesign: DuelDesign;
  onSubmitted: (duelId: string | null) => void;
}

type Tool = DuelComponentType | "select";
type DragMode =
  | { kind: "move"; startX: number; startY: number; origX: number; origY: number }
  | { kind: "resize"; handle: string; startX: number; startY: number; orig: DuelComponent };

const PALETTE: { type: Tool; label: string; icon: React.ReactNode }[] = [
  { type: "select", label: "Select", icon: <MousePointer2 size={17} /> },
  { type: "text", label: "Text", icon: <Type size={17} /> },
  { type: "button", label: "Button", icon: <Square size={17} /> },
  { type: "card", label: "Card", icon: <Square size={17} /> },
  { type: "input", label: "Input", icon: <TextCursorInput size={17} /> },
  { type: "image", label: "Image", icon: <ImageIcon size={17} /> },
];

const COLORS = [
  "#111111", "#555555", "#777777", "#FFFFFF", "#0070F3", "#0EA5E9", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#1F2937",
];

function clampCoord(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function DuelEditor({
  challenge,
  submissionId,
  deadline,
  initialDesign,
  onSubmitted,
}: DuelEditorProps) {
  const [design, setDesign] = useState<DuelDesign>(initialDesign);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [remaining, setRemaining] = useState(0);
  const [drag, setDrag] = useState<DragMode | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => design.components.find((c) => c.id === selectedId) ?? null,
    [design.components, selectedId],
  );

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.floor((Date.parse(deadline) - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [deadline]);

  // Prevent arrow scrolling the page while nudging with the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.startsWith("Arrow") && selectedId) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const mutateComponent = useCallback(
    (id: string, update: (component: DuelComponent) => DuelComponent) => {
      setDesign((current) => ({
        ...current,
        components: current.components.map((c) => (c.id === id ? update(c) : c)),
      }));
    },
    [],
  );

  const addComponent = useCallback((type: DuelComponentType) => {
    setDesign((current) => {
      const component = makeComponent(uid(), type, 24, 24 + (current.components.length % 6) * 24);
      setSelectedId(component.id);
      return { ...current, components: [...current.components, component] };
    });
    setTool("select");
  }, []);

  const removeComponent = useCallback((id: string) => {
    setDesign((current) => ({
      ...current,
      components: current.components.filter((c) => c.id !== id),
    }));
    setSelectedId(null);
  }, []);

  const duplicateComponent = useCallback((component: DuelComponent) => {
    const copy = { ...component, id: uid(), x: component.x + 16, y: component.y + 16 };
    setDesign((current) => ({ ...current, components: [...current.components, copy] }));
    setSelectedId(copy.id);
  }, []);

  const reorder = useCallback((id: string, delta: number) => {
    setDesign((current) => {
      const components = [...current.components];
      const index = components.findIndex((c) => c.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= components.length) return current;
      const [item] = components.splice(index, 1);
      components.splice(target, 0, item);
      return { ...current, components };
    });
  }, []);

  const nudge = useCallback((id: string, dx: number, dy: number) => {
    mutateComponent(id, (c) => ({
      ...c,
      x: clampCoord(c.x + dx, 0, design.frame.width),
      y: clampCoord(c.y + dy, 0, design.frame.height),
    }));
  }, [mutateComponent, design.frame.width, design.frame.height]);

  // ── Canvas pointer handling ───────────────────────────────────────────────

  // The frame renders scaled to fit the available width; pointer coordinates
  // are normalized back into design pixels by dividing by this scale.
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = frameRef.current?.parentElement;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      setScale(avail > 0 ? Math.min(1, avail / design.frame.width) : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [design.frame.width]);

  const toFrameCoords = (event: { clientX: number; clientY: number }) => {
    const rect = frameRef.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (rect?.left ?? 0)) / scale,
      y: (event.clientY - (rect?.top ?? 0)) / scale,
    };
  };

  useEffect(() => {
    const el = frameRef.current?.parentElement;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      setScale(avail > 0 ? Math.min(1, avail / design.frame.width) : 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [design.frame.width]);

  const handlePointerDown = (event: React.PointerEvent, component: DuelComponent) => {
    if (tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const point = toFrameCoords(event);
    setSelectedId(component.id);
    setDragStart({ x: point.x, y: point.y });
    setDrag({ kind: "move", startX: point.x, startY: point.y, origX: component.x, origY: component.y });
  };

  const handleResizeStart = (event: React.PointerEvent, component: DuelComponent, handle: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = toFrameCoords(event);
    setSelectedId(component.id);
    setDragStart({ x: point.x, y: point.y });
    setDrag({ kind: "resize", handle, startX: point.x, startY: point.y, orig: component });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const point = toFrameCoords(event);
    const dx = point.x - dragStart.x;
    const dy = point.y - dragStart.y;

    if (drag.kind === "move") {
      mutateComponent(selectedId!, (c) => ({
        ...c,
        x: clampCoord(drag.origX + dx, 0, design.frame.width),
        y: clampCoord(drag.origY + dy, 0, design.frame.height),
      }));
    } else {
      const { handle, orig } = drag;
      mutateComponent(orig.id, (c) => {
        let { x, y, width, height } = orig;
        const min = 16;
        if (handle.includes("w")) {
          const newWidth = clampCoord(orig.width - dx, min, orig.x + orig.width);
          x = orig.x + (orig.width - newWidth);
          width = newWidth;
        }
        if (handle.includes("e")) width = clampCoord(orig.width + dx, min, design.frame.width - orig.x);
        if (handle.includes("n")) {
          const newHeight = clampCoord(orig.height - dy, min, orig.y + orig.height);
          y = orig.y + (orig.height - newHeight);
          height = newHeight;
        }
        if (handle.includes("s")) height = clampCoord(orig.height + dy, min, design.frame.height - orig.y);
        return { ...c, x, y, width, height };
      });
    }
  };

  const endDrag = () => setDrag(null);

  const handleCanvasClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) setSelectedId(null);
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = useCallback(async () => {
    if (design.components.length === 0) {
      setSubmitError("Your design is empty. Add a few elements first.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      let previewImage: string | null = null;
      try {
        const canvas = renderDesignToCanvas(design, 2);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob) {
          const form = new FormData();
          form.append("file", blob, "duel.png");
          const upload = await fetch("/api/design-duel/upload", { method: "POST", body: form });
          if (upload.ok) {
            const uploadData = (await upload.json()) as { url?: string };
            previewImage = uploadData.url ?? null;
          }
        }
      } catch {
        // Preview is optional — fall back to vector rendering.
      }

      const response = await fetch(`/api/design-duel/challenges/${challenge.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: submissionId, design_json: design, preview_image: previewImage }),
      });
      const data = (await response.json()) as { error?: string; duel_id?: string | null };
      if (!response.ok) {
        setSubmitError(data.error ?? "Could not submit your design.");
        return;
      }
      onSubmitted(data.duel_id ?? null);
    } catch {
      setSubmitError("Could not submit your design.");
    } finally {
      setSubmitting(false);
    }
  }, [design, challenge.id, submissionId, onSubmitted]);

  const { pending, run } = usePendingMutation(submit);

  const timeLow = remaining > 0 && remaining <= 30;
  const timeWarn = remaining > 30 && remaining <= 120;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-body text-sm font-semibold text-foreground">{challenge.title}</p>
          <p className="font-body text-[11px] text-foreground-subtle">
            Fix the UI · submit before the timer ends
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-sm font-bold tabular-nums ${
              timeLow
                ? "bg-red-100 text-red-700"
                : timeWarn
                  ? "bg-amber-100 text-amber-700"
                  : "bg-surface-raised text-foreground"
            }`}
            role="timer"
          >
            {formatSeconds(remaining)}
          </span>
          {timeLow && <span className="hidden font-body text-xs font-semibold text-red-600 sm:block">Time&apos;s almost up</span>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 font-body text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Spinner size={16} className="text-white" /> : <Check size={16} />}
            {pending ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>

      {submitError && (
        <div className="border-b border-border bg-red-50 px-4 py-2 font-body text-xs font-medium text-red-600">
          {submitError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <div className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-3 md:flex">
          {PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              title={item.label}
              onClick={() => (item.type === "select" ? setTool("select") : addComponent(item.type))}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                tool === item.type
                  ? "bg-accent text-white"
                  : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 items-start justify-center overflow-auto bg-surface px-4 py-6">
          <div
            ref={frameRef}
            className="relative shrink-0 overflow-hidden rounded-2xl border border-border bg-white shadow-sm"
            style={{ width: design.frame.width * scale, height: design.frame.height * scale }}
            onClick={handleCanvasClick}
          >
            <div
              style={{ width: design.frame.width, height: design.frame.height, position: "relative", transform: `scale(${scale})`, transformOrigin: "top left" }}
            >
              {design.components.map((component) => {
                const isSelected = component.id === selectedId;
                return (
                  <div
                    key={component.id}
                    style={{
                      position: "absolute",
                      left: component.x,
                      top: component.y,
                      width: component.width,
                      height: component.height,
                      zIndex: 10 + (isSelected ? 1 : 0),
                      cursor: tool === "select" ? "move" : "default",
                    }}
                    onPointerDown={(event) => handlePointerDown(event, component)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={endDrag}
                    onDoubleClick={() => {
                      setSelectedId(component.id);
                      const field = document.getElementById("design-duel-props-text");
                      field?.focus();
                    }}
                  >
                    <div style={componentBodyStyle(component)}>
                      {component.type !== "image" && component.text}
                    </div>
                    {isSelected && (
                      <>
                        <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-accent" />
                        {["nw", "ne", "sw", "se", "e", "s"].map((handle) => (
                          <div
                            key={handle}
                            onPointerDown={(event) => handleResizeStart(event, component, handle)}
                            className="absolute h-3 w-3 rounded-full border-2 border-white bg-accent"
                            style={{
                              cursor:
                                handle === "e"
                                  ? "ew-resize"
                                  : handle === "s"
                                    ? "ns-resize"
                                    : handle === "nw" || handle === "se"
                                      ? "nwse-resize"
                                      : "nesw-resize",
                              ...cornerPosition(handle),
                            }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Properties */}
        <div className="hidden w-72 shrink-0 overflow-y-auto border-l border-border p-4 lg:block">
          <PropertiesPanel
            component={selected}
            onUpdate={mutateComponent}
            onRemove={removeComponent}
            onDuplicate={duplicateComponent}
            onReorder={reorder}
            onNudge={nudge}
          />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {selected && (
        <div className="border-t border-border bg-background px-4 pb-4 pt-2 lg:hidden">
          <div className="flex items-center justify-between">
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
              {selected.type} properties
            </p>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Close properties">
              <X size={16} />
            </button>
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto">
            <PropertiesPanel
              component={selected}
              onUpdate={mutateComponent}
              onRemove={removeComponent}
              onDuplicate={duplicateComponent}
              onReorder={reorder}
              onNudge={nudge}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function cornerPosition(handle: string): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (handle.includes("n")) style.top = -6;
  if (handle.includes("s")) style.bottom = -6;
  if (handle.includes("w")) style.left = -6;
  if (handle.includes("e")) style.right = -6;
  if (handle === "e") style.top = "calc(50% - 6px)";
  if (handle === "s") style.left = "calc(50% - 6px)";
  return style;
}

interface PropertiesPanelProps {
  component: DuelComponent | null;
  onUpdate: (id: string, update: (component: DuelComponent) => DuelComponent) => void;
  onRemove: (id: string) => void;
  onDuplicate: (component: DuelComponent) => void;
  onReorder: (id: string, delta: number) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
}

function PropertiesPanel({
  component,
  onUpdate,
  onRemove,
  onDuplicate,
  onReorder,
  onNudge,
}: PropertiesPanelProps) {
  const [imageUploading, setImageUploading] = useState(false);

  if (!component) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <MousePointer2 size={22} className="text-foreground-subtle" />
        <p className="font-body text-xs text-foreground-subtle">
          Select a layer to edit its properties.
        </p>
      </div>
    );
  }

  const set = (patch: Partial<DuelComponent>) => onUpdate(component.id, (c) => ({ ...c, ...patch }));

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setImageUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/design-duel/upload", { method: "POST", body: form });
      const data = (await response.json()) as { url?: string; error?: string };
      if (response.ok && data.url) set({ imageUrl: data.url, background: null });
    } catch {
      // ignore upload failures
    } finally {
      setImageUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-body text-sm font-semibold text-foreground">
          {component.type === "text" ? "Text" : component.type === "button" ? "Button" : component.type === "card" ? "Card" : component.type === "input" ? "Input" : "Image"}
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onReorder(component.id, -1)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-raised hover:text-foreground" aria-label="Move up">
            <ChevronUp size={15} />
          </button>
          <button type="button" onClick={() => onReorder(component.id, 1)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-raised hover:text-foreground" aria-label="Move down">
            <ChevronDown size={15} />
          </button>
          <button type="button" onClick={() => onDuplicate(component)} className="rounded-md p-1.5 text-foreground-muted hover:bg-surface-raised hover:text-foreground" aria-label="Duplicate">
            <Copy size={15} />
          </button>
          <button type="button" onClick={() => onRemove(component.id)} className="rounded-md p-1.5 text-red-500 hover:bg-red-50" aria-label="Delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {component.type !== "image" && (
        <Field label="Text">
          <textarea
            id="design-duel-props-text"
            rows={component.type === "text" ? 3 : 2}
            value={component.text}
            onChange={(event) => set({ text: event.target.value })}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none focus:border-accent"
            placeholder="Layer text…"
          />
        </Field>
      )}

      {component.type === "image" && (
        <Field label="Image">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 font-body text-xs font-medium text-foreground-muted hover:border-accent hover:text-foreground">
            {imageUploading ? <Spinner size={14} /> : <Upload size={14} />}
            {imageUploading ? "Uploading…" : "Upload image"}
            <input type="file" accept="image/*" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImageUpload(file);
              event.target.value = "";
            }} />
          </label>
          {component.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={component.imageUrl} alt="" className="mt-2 max-h-24 w-full rounded-lg border border-border object-cover" />
          )}
          {component.imageUrl && (
            <button type="button" onClick={() => set({ imageUrl: null })} className="mt-1 font-body text-[11px] font-medium text-red-500">
              Remove image
            </button>
          )}
        </Field>
      )}

      {component.type === "text" || component.type === "card" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">
            <input type="number" value={component.fontSize} min={8} max={96} onChange={(event) => set({ fontSize: Number(event.target.value) || 14 })} className={inputClass} />
          </Field>
          <Field label="Weight">
            <select value={component.fontWeight} onChange={(event) => set({ fontWeight: Number(event.target.value) })} className={inputClass}>
              <option value={400}>Regular</option>
              <option value={500}>Medium</option>
              <option value={600}>Semibold</option>
              <option value={700}>Bold</option>
              <option value={800}>Extra bold</option>
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Font size">
          <input type="number" value={component.fontSize} min={8} max={96} onChange={(event) => set({ fontSize: Number(event.target.value) || 14 })} className={inputClass} />
        </Field>
      )}

      {(component.type === "text" || component.type === "button" || component.type === "card") && (
        <Field label="Align">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => set({ align })}
                className={`flex-1 px-2 py-1.5 font-body text-[11px] font-semibold capitalize transition-colors ${
                  component.align === align ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-raised"
                }`}
              >
                {align}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Text color">
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => set({ color })}
              className="h-6 w-6 rounded-md border border-border"
              style={{ background: color }}
              aria-label={`Color ${color}`}
            />
          ))}
        </div>
      </Field>

      {(component.type === "button" || component.type === "card" || component.type === "input") && (
        <Field label="Background">
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => set({ background: color })}
                className={`h-6 w-6 rounded-md border ${component.background === color ? "border-accent ring-2 ring-accent/40" : "border-border"}`}
                style={{ background: color }}
                aria-label={`Background ${color}`}
              />
            ))}
          </div>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Radius">
          <input type="number" value={component.radius} min={0} max={48} onChange={(event) => set({ radius: Number(event.target.value) || 0 })} className={inputClass} />
        </Field>
        <Field label="Opacity">
          <input type="number" value={component.opacity} min={0.1} max={1} step={0.05} onChange={(event) => set({ opacity: Number(event.target.value) || 1 })} className={inputClass} />
        </Field>
      </div>

      <Field label="Position">
        <div className="grid grid-cols-4 gap-2">
          <input type="number" value={component.x} onChange={(event) => set({ x: Number(event.target.value) || 0 })} className={inputClass} aria-label="X" />
          <input type="number" value={component.y} onChange={(event) => set({ y: Number(event.target.value) || 0 })} className={inputClass} aria-label="Y" />
          <input type="number" value={component.width} min={8} onChange={(event) => set({ width: Number(event.target.value) || 16 })} className={inputClass} aria-label="W" />
          <input type="number" value={component.height} min={8} onChange={(event) => set({ height: Number(event.target.value) || 16 })} className={inputClass} aria-label="H" />
        </div>
        <div className="mt-2 flex gap-2">
          {[
            { label: "←", dx: -4, dy: 0 },
            { label: "↑", dx: 0, dy: -4 },
            { label: "↓", dx: 0, dy: 4 },
            { label: "→", dx: 4, dy: 0 },
          ].map((arrow) => (
            <button
              key={arrow.label}
              type="button"
              onClick={() => onNudge(component.id, arrow.dx, arrow.dy)}
              className="flex-1 rounded-lg border border-border py-1 font-body text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            >
              {arrow.label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 font-body text-sm text-foreground outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{label}</p>
      {children}
    </div>
  );
}