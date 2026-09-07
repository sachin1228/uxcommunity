import type { Metadata } from "next";
import { GamesHome } from "@/components/games/GamesHome";

export const metadata: Metadata = {
  title: "Games — uxcommunity",
};

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GamesPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const raw = typeof params.room === "string" ? params.room : "";
  return <GamesHome initialRoom={raw} />;
}
