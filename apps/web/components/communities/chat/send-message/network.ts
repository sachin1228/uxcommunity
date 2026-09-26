import { dedupeFetch } from "@/lib/dedupe-fetch";
import { compressImage, compressedFile } from "@/lib/image-client";

/** Uploads a chat image and returns its public URL, or throws a user-facing error. */
export async function uploadMessageImage(
  communityId: string,
  imageFile: File,
  signal: AbortSignal,
): Promise<string> {
  // Compress on the client (canvas → WebP); the upload route stores the
  // bytes as-is since server-side Sharp is unavailable on Workers.
  let fileToSend: File;
  try {
    fileToSend = compressedFile(await compressImage(imageFile), imageFile);
  } catch {
    fileToSend = imageFile;
  }
  const fd = new FormData();
  fd.append("file", fileToSend);

  const uploadRes = await fetch(`/api/communities/${communityId}/messages/upload`, {
    method: "POST",
    body: fd,
    signal,
  });

  if (!uploadRes.ok) {
    const d = await uploadRes.json().catch(() => ({}));
    throw new Error((d as { error?: string }).error ?? "Image upload failed.");
  }

  const uploadData: unknown = await uploadRes.json().catch(() => null);
  const bodyUrl =
    uploadData &&
    typeof uploadData === "object" &&
    "url" in uploadData &&
    typeof uploadData.url === "string"
      ? uploadData.url.trim()
      : "";
  const headerUrl = uploadRes.headers.get("X-Image-Url")?.trim() ?? "";
  const uploadedUrl = bodyUrl || headerUrl;

  if (!uploadedUrl) {
    throw new Error("Image upload failed: the server returned an invalid response.");
  }
  return uploadedUrl;
}

/**
 * POST a chat message. Every body must carry a unique `client_nonce` (the temp
 * id): dedupeFetch joins identical in-flight requests and replays recently
 * settled ones by method + URL + body, so without it two identical messages
 * ("ok", "ok") would merge into one and the second never reaches the server.
 */
export function postMessage(
  communityId: string,
  body: Record<string, unknown> & { client_nonce: string },
  signal: AbortSignal,
): Promise<Response> {
  return dedupeFetch(`/api/communities/${communityId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
