// ─── Lottie admin API helpers ─────────────────────────────────────────────────

export async function uploadLottieFile(
  file: File,
  onError: (msg: string) => void
): Promise<string | null> {
  if (!file.name.endsWith(".json")) {
    onError("Please upload a .json Lottie file.");
    return null;
  }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/admin/lottie-upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) { onError(data.error ?? "Upload failed."); return null; }
  return data.url as string;
}

export async function saveLottieSetting(
  scope: "universal" | "type" | "community",
  scope_key: string,
  lottie_url: string
): Promise<boolean> {
  const res = await fetch("/api/admin/lottie-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, scope_key, lottie_url }),
  });
  return res.ok;
}

export async function deleteLottieSetting(id: string): Promise<boolean> {
  const res = await fetch(`/api/admin/lottie-settings/${id}`, { method: "DELETE" });
  return res.ok;
}
