import { NextRequest, NextResponse } from "next/server";

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const BASE = "https://api.giphy.com/v1";

export async function GET(req: NextRequest) {
  if (!GIPHY_API_KEY) {
    return NextResponse.json({ error: "GIPHY not configured" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const rawType = searchParams.get("type");
  const type = rawType === "sticker" ? "stickers" : "gifs";
  const q = searchParams.get("q") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);
  const offset = Number(searchParams.get("offset") ?? "0");

  const endpoint = q ? "search" : "trending";
  const url = new URL(`${BASE}/${type}/${endpoint}`);
  url.searchParams.set("api_key", GIPHY_API_KEY);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", "g");
  if (q) url.searchParams.set("q", q);

  let res: Response;
  try {
    res = await fetch(url.toString(), { next: { revalidate: 60 } });
  } catch {
    return NextResponse.json({ error: "Failed to reach GIPHY" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: "GIPHY request failed" }, { status: 502 });
  }

  const data = await res.json() as {
    data: Array<{
      id: string;
      title?: string;
      images?: {
        fixed_height?: { url?: string; width?: string; height?: string };
        fixed_height_small?: { url?: string };
        original?: { url?: string };
      };
    }>;
  };

  const results = (data.data ?? []).map((item) => {
    const fh = item.images?.fixed_height;
    const fhs = item.images?.fixed_height_small;
    const w = Number(fh?.width ?? 1);
    const h = Number(fh?.height ?? 1);
    return {
      id: item.id,
      title: item.title ?? "",
      previewUrl: fhs?.url ?? fh?.url ?? "",
      sendUrl: fh?.url ?? item.images?.original?.url ?? "",
      aspectRatio: h > 0 ? w / h : 1,
    };
  });

  return NextResponse.json({ results });
}
