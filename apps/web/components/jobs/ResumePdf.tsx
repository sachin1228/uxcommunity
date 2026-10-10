"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Minus, MoveHorizontal, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Chrome's viewer ladder, near enough — the buttons step through it.
const ZOOM_LEVELS = [25, 33, 50, 67, 75, 100, 125, 150, 175, 200, 250, 300, 400];

/**
 * The resume pane's PDF viewer — ours rather than the browser's, so the
 * tools (zoom, fit width, open in new tab) float on the right edge instead
 * of sitting in the browser's toolbar across the top. Pages render to
 * canvas; it opens at 50%, where a resume reads well (100% = 96 dpi, the
 * browser's own convention).
 */
export function ResumePdf({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const baseWidthRef = useRef<number | null>(null);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(50);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const loaded = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        const firstPage = await loaded.getPage(1);
        baseWidthRef.current = firstPage.getViewport({ scale: 1 }).width;
        setNumPages(loaded.numPages);
        setDoc(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      void doc?.destroy();
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const scale = zoom / 75;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      try {
        for (let index = 0; index < doc.numPages; index++) {
          const page = await doc.getPage(index + 1);
          const canvas = canvasRefs.current[index];
          if (cancelled || !canvas) return;
          const viewport = page.getViewport({ scale });
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const context = canvas.getContext("2d");
          if (!context) return;
          task = page.render({
            canvasContext: context,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          });
          await task.promise;
          if (cancelled) return;
        }
      } catch {
        // Stepping the zoom cancels the in-flight render; that is expected.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, zoom]);

  const zoomOut = () =>
    setZoom((current) => ZOOM_LEVELS.filter((level) => level < current).pop() ?? ZOOM_LEVELS[0]);
  const zoomIn = () =>
    setZoom(
      (current) => ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
    );
  const fitWidth = () => {
    const container = containerRef.current;
    const baseWidth = baseWidthRef.current;
    if (!container || !baseWidth) return;
    setZoom(Math.max(10, Math.round(((container.clientWidth - 48) / baseWidth) * 75)));
  };

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full overflow-auto bg-background-subtle">
        <div className="flex flex-col items-center gap-4 px-6 py-6">
          {Array.from({ length: numPages }, (_, index) => (
            <canvas
              key={index}
              ref={(node) => {
                canvasRefs.current[index] = node;
              }}
              width={0}
              height={0}
              className="bg-white shadow-[0_2px_14px_rgba(0,0,0,0.16)]"
            />
          ))}
        </div>
      </div>

      {/* The tool rail — on the right edge, floating over the pages like the
          app's other pills. */}
      <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center rounded-full border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <RailButton label="Zoom out" disabled={zoom <= ZOOM_LEVELS[0]} onClick={zoomOut}>
          <Minus strokeWidth={2.5} size={15} />
        </RailButton>
        <span className="w-10 py-0.5 text-center font-body text-[11px] font-medium tabular-nums text-foreground-muted">
          {zoom}%
        </span>
        <RailButton
          label="Zoom in"
          disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          onClick={zoomIn}
        >
          <Plus strokeWidth={2.5} size={15} />
        </RailButton>
        <span aria-hidden="true" className="my-1 h-px w-5 bg-border" />
        <RailButton label="Fit width" onClick={fitWidth}>
          <MoveHorizontal strokeWidth={2.5} size={15} />
        </RailButton>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in new tab"
          title="Open in new tab"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground"
        >
          <ExternalLink strokeWidth={2.5} size={15} />
        </a>
      </div>

      {!doc && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={18} />
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <p className="font-body text-sm text-foreground-muted">Couldn’t load the resume.</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-body text-sm font-medium text-accent underline underline-offset-4"
          >
            Open in new tab
          </a>
        </div>
      )}
    </div>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-accent-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-foreground-muted"
    >
      {children}
    </button>
  );
}
