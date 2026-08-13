export type FigmaLinkKind = "prototype" | "file";

const FIGMA_HOSTS = new Set(["figma.com", "www.figma.com", "embed.figma.com"]);
const FIGMA_FILE_SEGMENTS = new Set(["design", "file", "board", "proto"]);

export function parseFigmaUrl(value: string): { kind: FigmaLinkKind; url: URL } | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !FIGMA_HOSTS.has(url.hostname.toLowerCase())) {
      return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const kindSegment = segments[0];
    if (!kindSegment || !FIGMA_FILE_SEGMENTS.has(kindSegment) || !segments[1]) return null;

    return { kind: kindSegment === "proto" ? "prototype" : "file", url };
  } catch {
    return null;
  }
}

export function getFigmaEmbedUrl(value: string): string | null {
  const parsed = parseFigmaUrl(value);
  if (!parsed || parsed.kind !== "prototype") return null;

  const embedUrl = new URL(`https://embed.figma.com${parsed.url.pathname}`);
  parsed.url.searchParams.forEach((parameterValue, parameterName) => {
    if (parameterName !== "embed-host") embedUrl.searchParams.append(parameterName, parameterValue);
  });
  embedUrl.searchParams.set("embed-host", "share");
  return embedUrl.toString();
}
