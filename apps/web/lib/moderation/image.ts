import { getModerationConfig } from "./config";
import type { ModerationDecision, RuleHit } from "./types";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_RIFF = "RIFF";
const WEBP_WEBP = "WEBP";

function decision(status: "approved" | "review" | "rejected", reason: string, confidence: number, hits: RuleHit[] = []): ModerationDecision {
  return {
    status,
    allowed: status === "approved",
    reason,
    provider: "image-gateway",
    confidence,
    triggered_rules: hits,
    scores: reason ? { [reason.replace(/\W+/g, "_")]: confidence } : {},
    duration_ms: 0,
  };
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

export function detectImageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length < 12) return null;
  if (hasPrefix(buffer, JPEG)) return "image/jpeg";
  if (hasPrefix(buffer, PNG)) return "image/png";
  if (
    buffer.subarray(0, 4).toString("ascii") === WEBP_RIFF &&
    buffer.subarray(8, 12).toString("ascii") === WEBP_WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export async function validateAndModerateImage(file: File | Blob): Promise<{ decision: ModerationDecision; buffer?: Buffer; mime?: string }> {
  const start = Date.now();
  const config = getModerationConfig();

  if (!config.images.allowedMimeTypes.includes(file.type)) {
    return { decision: { ...decision("rejected", "Unsupported image content type.", 1), duration_ms: Date.now() - start } };
  }
  if (file.size > config.images.maxBytes) {
    return { decision: { ...decision("rejected", "Image exceeds maximum size.", 1), duration_ms: Date.now() - start } };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const realMime = detectImageMime(buffer);
  if (!realMime || realMime !== file.type) {
    return { decision: { ...decision("rejected", "Image bytes do not match an allowed MIME type.", 1), duration_ms: Date.now() - start } };
  }

  if (!config.images.serviceUrl) {
    return { decision: { ...decision("review", "Image moderation service is not configured.", 1), duration_ms: Date.now() - start }, buffer, mime: realMime };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.images.timeoutMs);

  try {
    const form = new FormData();
    form.set("file", new Blob([buffer], { type: realMime }), "upload");
    const response = await fetch(`${config.images.serviceUrl.replace(/\/$/, "")}/moderate`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { decision: { ...decision("review", "Image moderation service returned an error.", 1), duration_ms: Date.now() - start }, buffer, mime: realMime };
    }

    const payload = (await response.json()) as Partial<ModerationDecision>;
    const status = payload.status === "approved" || payload.status === "review" || payload.status === "rejected" ? payload.status : "review";
    const allowed = status === "approved" && payload.allowed === true;
    const safeStatus = allowed ? "approved" : status === "approved" ? "review" : status;
    return {
      decision: {
        status: safeStatus,
        allowed,
        reason: typeof payload.reason === "string" ? payload.reason : "",
        provider: typeof payload.provider === "string" ? payload.provider : "nudenet",
        confidence: typeof payload.confidence === "number" ? payload.confidence : 0,
        triggered_rules: Array.isArray(payload.triggered_rules) ? payload.triggered_rules : [],
        scores: payload.scores && typeof payload.scores === "object" ? payload.scores as Record<string, number> : {},
        duration_ms: Date.now() - start,
      },
      buffer,
      mime: realMime,
    };
  } catch (error) {
    console.error("[moderation:image]", error);
    return { decision: { ...decision("review", "Image moderation service failed.", 1), duration_ms: Date.now() - start }, buffer, mime: realMime };
  } finally {
    clearTimeout(timeout);
  }
}
