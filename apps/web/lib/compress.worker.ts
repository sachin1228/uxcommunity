/**
 * WebP compression worker — jSquash (Squoosh-derived) libwebp WASM encoder.
 *
 * Runs entirely off the main thread:
 *   1. Receives the original File + resize cap.
 *   2. Decodes it (EXIF orientation is applied by `createImageBitmap`).
 *   3. Draws it onto an `OffscreenCanvas` at the capped size (downscale only,
 *      aspect preserved, never upscaled).
 *   4. Encodes the raw RGBA pixels to WebP at quality 0.90 via @jsquash/webp.
 *   5. Transfers the encoded ArrayBuffer back to the main thread.
 *
 * The module is only ever evaluated inside a browser Worker (never SSR /
 * Cloudflare Workers / server components), so DOM-free APIs are safe here.
 */

import { encode } from "@jsquash/webp";
import { fitWithinBounds } from "./image-geometry";

/**
 * Universal quality. WebP (libwebp) accepts 0–100; 0.90 is the product-level
 * setting on the 0–1 scale used everywhere else in the app (canvas, native
 * pickers), so it is converted to 90 when calling the encoder. Kept in lockstep
 * with IMAGE_QUALITY in lib/image-client.ts.
 */
const IMAGE_QUALITY = 0.9;

interface CompressRequest {
  id: number;
  file: File;
  /** Longest-edge cap. Images larger than this are downscaled proportionally. */
  maxDimension: number;
}

interface CompressSuccess {
  id: number;
  ok: true;
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

interface CompressFailure {
  id: number;
  ok: false;
  error: string;
}

/**
 * Minimal worker-scope typing so this file typechecks against the DOM lib
 * (which types `self` as Window and `postMessage` with a target-origin arg).
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<CompressRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function compress(request: CompressRequest): Promise<CompressSuccess | CompressFailure> {
  const { id, file, maxDimension } = request;
  try {
    if (typeof createImageBitmap !== "function") {
      throw new Error("createImageBitmap is not available in this worker.");
    }
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not available in this worker.");
    }

    // Decode off the main thread. `createImageBitmap` applies EXIF orientation
    // by default (imageOrientation: "from-image"), so photos land upright.
    const bitmap = await createImageBitmap(file);

    const target = fitWithinBounds(bitmap.width, bitmap.height, maxDimension);
    const canvas = new OffscreenCanvas(target.width, target.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a 2D context in the worker.");

    // High-quality downsampling — important for thin lines / small text.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    // Free the decoded bitmap (GPU/decoder memory) as soon as it is painted.
    bitmap.close();

    // Raw RGBA is what the jSquash WebP encoder consumes.
    const imageData = ctx.getImageData(0, 0, target.width, target.height);
    const encoded = await encode(imageData, {
      quality: Math.round(IMAGE_QUALITY * 100),
    });

    return { id, ok: true, buffer: encoded, width: target.width, height: target.height };
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "WebP compression failed in worker.",
    };
  }
}

scope.onmessage = (event: MessageEvent<CompressRequest>) => {
  void compress(event.data).then((result) => {
    // Buffer is transferable — avoids a copy of the encoded bytes on the way back.
    if (result.ok) {
      scope.postMessage(result, [result.buffer]);
    } else {
      scope.postMessage(result);
    }
  });
};
