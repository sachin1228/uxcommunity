/** Shared constants and helpers for thread card rendering. */

export const CATEGORY_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  question:     { border: "#7C3AED", text: "#A78BFA", bg: "rgba(124,58,237,0.10)" },
  discussion:   { border: "#0070F3", text: "#60A5FA", bg: "rgba(0,112,243,0.10)"  },
  idea:         { border: "#D97706", text: "#FCD34D", bg: "rgba(217,119,6,0.10)"  },
  feedback:     { border: "#EA580C", text: "#FB923C", bg: "rgba(234,88,12,0.10)"  },
  referral:     { border: "#16A34A", text: "#4ADE80", bg: "rgba(22,163,74,0.10)"  },
  collaboration:{ border: "#0891B2", text: "#67E8F9", bg: "rgba(8,145,178,0.10)"  },
};

export function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatFullDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
