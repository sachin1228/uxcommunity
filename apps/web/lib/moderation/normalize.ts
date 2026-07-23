const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "!": "i",
};

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET_MAP[char] ?? char)
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^\p{L}\p{N}\s:/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
