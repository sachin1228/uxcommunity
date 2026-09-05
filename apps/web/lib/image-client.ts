/**
 * Client-side image compression — jSquash (Squoosh-derived) libwebp WASM.
 *
 * Pipeline (browser only):
 *
 *   File ──▶ Web Worker ──▶ decode (createImageBitmap, EXIF applied)
 *        ──▶ downscale to ≤ MAX_DIMENSION (aspect preserved, never upscaled)
 *        ──▶ jSquash WebP WASM encode at IMAGE_QUALITY (0.90)
 *        ──▶ Blob(image/webp) ──▶ existing upload flow
 *
 * If the Worker path is unavailable (old browser, blocked Worker, no
 * OffscreenCanvas in the worker) the same encode runs on the main thread so
 * uploads still work. The encoder module is loaded lazily and only ever
 * executed in the browser — nothing here touches `window`/`Worker` at module
 * scope, so SSR and Cloudflare Workers builds are safe.
 *
 * Output is always WebP (`image/webp`, `.webp` extension). The `.webp`
 * filename is applied by `compressedFile()` at the call site.
 */

import { fitWithinBounds, IMAGE_QUALITY, MAX_DIMENSION, readWebpDimensions } from "./image-geometry";

export { IMAGE_QUALITY, MAX_DIMENSION } from "./image-geometry";

export interface ClientCompressedImage {
  blob: Blob;
  contentType: "image/webp";
  /** Encoded pixel dimensions (omitted when the original WebP is reused). */
  width?: number;
  height?: number;
}

export interface CompressOptions {
  /**
   * Longest-edge cap (px). Images larger than this are downscaled
   * proportionally; smaller images keep their original dimensions.
   */
  maxDimension?: number;
}

/**
 * Avatar uploads are displayed tiny (≤ a few hundred CSS pixels at 2–3x), so
 * they are capped well below MAX_DIMENSION to keep R2 storage/bandwidth
 * sensible while still encoding at IMAGE_QUALITY.
 */
const AVATAR_MAX_DIMENSION = 400;

// ── Web Worker plumbing ──────────────────────────────────────────────────────
// A single lazily-created Worker is shared across calls (the jSquash encoder
// module stays warm inside it, so repeated compressions skip WASM re-init).

let worker: Worker | null = null;
let workerBroken = false;
let requestSeq = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: ArrayBuffer) => void; reject: (reason: Error) => void }
>();

const WORKER_TIMEOUT_MS = 120_000;

function isWorkerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof URL !== "undefined"
  );
}

function failAllPending(reason: Error) {
  for (const { reject } of pendingRequests.values()) reject(reason);
  pendingRequests.clear();
}

function createWorker(): Worker {
  // `new URL(..., import.meta.url)` is a static bundler hint — Next emits the
  // worker chunk and any wasm assets it needs. Guarded by isWorkerSupported().
  const instance = new Worker(new URL("./compress.worker.ts", import.meta.url), {
    name: "webp-compress",
  });

  instance.onmessage = (event: MessageEvent) => {
    const message = event.data as { id: number; ok: boolean; buffer?: ArrayBuffer; error?: string };
    const entry = pendingRequests.get(message.id);
    if (!entry) return;
    pendingRequests.delete(message.id);
    if (message.ok && message.buffer) entry.resolve(message.buffer);
    else entry.reject(new Error(message.error ?? "WebP compression failed in worker."));
  };

  instance.onerror = () => {
    // The worker died (e.g. wasm fetch failed) — fail in-flight work, drop the
    // instance so the next call recreates it, and let callers fall back to the
    // main-thread encoder.
    workerBroken = true;
    worker = null;
    failAllPending(new Error("WebP compression worker crashed."));
  };

  return instance;
}

function requestWorkerCompression(file: File, maxDimension: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (workerBroken || !worker) {
      try {
        worker = createWorker();
        workerBroken = false;
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not start compression worker."));
        return;
      }
    }

    const id = ++requestSeq;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      workerBroken = true;
      worker?.terminate();
      worker = null;
      reject(new Error("WebP compression timed out."));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });

    worker.postMessage({ id, file, maxDimension });
  });
}

// ── Main-thread fallback encoder (no Worker / no OffscreenCanvas) ───────────

let mainThreadEncoderPromise: Promise<typeof import("@jsquash/webp")> | null = null;

function loadEncoder(): Promise<typeof import("@jsquash/webp")> {
  // Lazy: the @jsquash/webp module (emscripten glue + wasm assets) is only
  // loaded when a browser actually needs to compress, never during SSR.
  if (!mainThreadEncoderPromise) {
    mainThreadEncoderPromise = import("@jsquash/webp");
  }
  return mainThreadEncoderPromise;
}

async function decodeToImageData(file: File, maxDimension: number): Promise<{ data: ImageData; width: number; height: number }> {
  // Preferred: createImageBitmap (keeps EXIF orientation). Falls back to an
  // <img> + canvas decode for engines without createImageBitmap.
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const target = fitWithinBounds(bitmap.width, bitmap.height, maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D is not supported.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
      const data = ctx.getImageData(0, 0, target.width, target.height);
      return { data, width: target.width, height: target.height };
    } finally {
      bitmap.close();
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const target = fitWithinBounds(img.naturalWidth, img.naturalHeight, maxDimension);
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D is not supported.");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, target.width, target.height);
        const data = ctx.getImageData(0, 0, target.width, target.height);
        resolve({ data, width: target.width, height: target.height });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to prepare image."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image."));
    };
    img.src = objectUrl;
  });
}

async function compressOnMainThread(file: File, maxDimension: number): Promise<ClientCompressedImage> {
  const { encode } = await loadEncoder();
  const { data, width, height } = await decodeToImageData(file, maxDimension);
  const encoded = await encode(data, { quality: Math.round(IMAGE_QUALITY * 100) });
  const blob = new Blob([encoded], { type: "image/webp" });
  return { blob, contentType: "image/webp", width, height };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compress any image to WebP at quality 0.90, fitting inside `maxDimension`
 * (default 2560) on the longest edge. Never upscales, never crops, keeps the
 * aspect ratio, and preserves alpha (transparent PNGs stay transparent).
 *
 * Already-encoded WebP files that fit inside the cap are returned untouched —
 * re-encoding them would only add another lossy generation. Everything else is
 * decoded, oriented, optionally downscaled, and encoded with the libwebp WASM
 * codec (in a Web Worker when supported).
 *
 * Throws on decode/encode failures so callers can fall back explicitly.
 */
export async function compressImage(file: File, options?: CompressOptions): Promise<ClientCompressedImage> {
  const maxDimension = options?.maxDimension ?? MAX_DIMENSION;

  // WebP passthrough — reuse the original bytes when they already meet the
  // output contract (correct format, within the dimension cap).
  if (file.type === "image/webp") {
    const dimensions = await readWebpDimensions(file);
    if (dimensions && dimensions.width <= maxDimension && dimensions.height <= maxDimension) {
      return { blob: file, contentType: "image/webp" };
    }
  }

  // Preferred path: encode in the shared Web Worker (keeps big uploads from
  // freezing the UI). Falls back to the main thread when unavailable.
  if (isWorkerSupported()) {
    try {
      const buffer = await requestWorkerCompression(file, maxDimension);
      const blob = new Blob([buffer], { type: "image/webp" });
      const dimensions = await readWebpDimensions(blob);
      return {
        blob,
        contentType: "image/webp",
        ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
      };
    } catch (workerError) {
      console.warn("[image-client] Worker compression failed; falling back to main thread.", workerError);
    }
  }

  return compressOnMainThread(file, maxDimension);
}

/**
 * Compress an avatar/community image to WebP quality 0.90, fit inside
 * 400×400 (aspect preserved, never upscaled, never cropped).
 */
export function compressAvatarClient(file: File): Promise<ClientCompressedImage> {
  return compressImage(file, { maxDimension: AVATAR_MAX_DIMENSION });
}

/** Wrap a compressed blob as a `.webp` File so it can be appended to FormData. */
export function compressedFile(compressed: ClientCompressedImage, original: File): File {
  const name = original.name.replace(/\.[^./]+$/, "") || "image";
  return new File([compressed.blob], `${name}.webp`, { type: compressed.contentType });
}

/**
 * Warm the browser cache for an image URL. Resolves once the image has been
 * fetched and decoded (or failed), so the caller can swap an `<img>` src from
 * a local blob URL to the uploaded network URL without the blank-frame flash
 * that happens while the bytes are still in flight. Resolves on error too — a
 * dead URL must never hang the caller.
 */
export function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}
