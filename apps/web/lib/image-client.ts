/**
 * Client-side image compression — replaces the server-side Sharp helpers that
 * can't run in the Cloudflare Workers runtime.
 *
 * Renders the image to a canvas (respecting EXIF orientation), scales it down
 * to fit inside the given bounding box without upscaling, and encodes to WebP.
 * Mirrors the settings previously used by `compressAvatar` / `compressChatImage`.
 */

export interface ClientCompressedImage {
  blob: Blob;
  contentType: "image/webp";
}

function drawToCanvas(file: File, maxDim: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      let { naturalWidth: width, naturalHeight: height } = img;
      const longest = Math.max(width, height);
      if (longest > maxDim) {
        const scale = maxDim / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = objectUrl;
  });
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("WebP encoding failed"));
      },
      "image/webp",
      quality,
    );
  });
}

/**
 * Compress an avatar image to WebP, max 400×400 (fit inside, no upscale),
 * quality 0.85 — matches the old server-side `compressAvatar`.
 */
export async function compressAvatarClient(file: File): Promise<ClientCompressedImage> {
  const canvas = await drawToCanvas(file, 400);
  const blob = await canvasToWebP(canvas, 0.85);
  return { blob, contentType: "image/webp" };
}

/**
 * Compress a chat/feed image to WebP, max 1200×1200 (fit inside, no upscale),
 * quality 0.65 — matches the old server-side `compressChatImage`.
 */
export async function compressChatImageClient(file: File): Promise<ClientCompressedImage> {
  const canvas = await drawToCanvas(file, 1200);
  const blob = await canvasToWebP(canvas, 0.65);
  return { blob, contentType: "image/webp" };
}

/** Wrap a compressed blob as a File so it can be appended to FormData. */
export function compressedFile(compressed: ClientCompressedImage, original: File): File {
  const name = original.name.replace(/\.[^./]+$/, "") || "image";
  return new File([compressed.blob], `${name}.webp`, { type: compressed.contentType });
}