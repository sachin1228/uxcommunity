import { signedRequest } from "../../../packages/shared/src/storage-signature.mjs";
import type { MediaBindings } from "./r2-bindings";

export async function serveStagingMedia(request: Request, env: MediaBindings & Record<string, unknown>): Promise<Response> {
  if (env.APP_ENV !== "staging") return new Response("Wrong environment", { status: 503 });
  const url = new URL(request.url);
  const publicRead = url.pathname.startsWith("/_media/") && ["GET", "HEAD"].includes(request.method);
  let bucket = env.MEDIA_R2_BUCKET;
  let key: string;
  if (publicRead) key = decodeURIComponent(url.pathname.slice("/_media/".length));
  else {
    const [name, ...parts] = url.pathname.slice("/_s3/".length).split("/");
    if (name === "uxcommunity-staging-private") bucket = env.PRIVATE_R2_BUCKET;
    else if (name !== "uxcommunity-staging-media") return new Response("Not found", { status: 404 });
    key = parts.map(decodeURIComponent).join("/");
    if (typeof env.R2_SECRET_ACCESS_KEY !== "string" || env.R2_SECRET_ACCESS_KEY.length < 32 || env.R2_ACCESS_KEY_ID !== "staging-runtime") return new Response("Storage unavailable", { status: 503 });
    const signed = signedRequest({ method: request.method, headers: { ...Object.fromEntries(request.headers), host: url.host } }, url, Buffer.alloc(0), env.R2_SECRET_ACCESS_KEY, env.R2_ACCESS_KEY_ID);
    if (!signed) return new Response("Forbidden", { status: 403 });
  }
  if (!key) return new Response("Not found", { status: 404 });
  if (request.method === "PUT" && !publicRead) {
    if (Number(request.headers.get("Content-Length")) > 55 * 1024 * 1024) return new Response("Too large", { status: 413 });
    if (!request.body) return new Response("Body required", { status: 400 });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 55 * 1024 * 1024) { await reader.cancel(); return new Response("Too large", { status: 413 }); }
      chunks.push(value);
    }
    const object = await bucket.put(key, Buffer.concat(chunks), { httpMetadata: {
      contentType: request.headers.get("Content-Type") ?? "application/octet-stream",
      cacheControl: bucket === env.PRIVATE_R2_BUCKET ? "private, no-store" : "public, max-age=31536000, immutable",
    } });
    return new Response(null, { headers: { ETag: object.httpEtag } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Not allowed", { status: 405 });
  const rangeHeader = request.headers.get("Range");
  const rangeMatch = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
  if (rangeHeader && !rangeMatch) return new Response("Unsupported range", { status: 416 });
  const offset = rangeMatch ? Number(rangeMatch[1]) : 0;
  const end = rangeMatch?.[2] ? Number(rangeMatch[2]) : undefined;
  if (end !== undefined && end < offset) return new Response("Invalid range", { status: 416 });
  const range = rangeMatch ? { offset, ...(end !== undefined ? { length: end - offset + 1 } : {}) } : undefined;
  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({ ETag: object.httpEtag, "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": publicRead ? "public, max-age=31536000, immutable" : "private, no-store" });
  let status = 200;
  if (request.headers.has("Range") && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0, length = object.range.length ?? object.size - offset;
    status = 206; headers.set("Content-Range", `bytes ${offset}-${offset+length-1}/${object.size}`);
  }
  return new Response(request.method === "HEAD" ? null : object.body as ReadableStream, { status, headers });
}
