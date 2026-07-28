import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { JoinCommunityClient } from "./JoinCommunityClient";

interface PageProps {
  params: Promise<{ token: string }>;
}

async function getCommunityByToken(token: string, origin: string) {
  try {
    const res = await fetch(`${origin}/api/communities/join/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.community ?? null;
  } catch {
    return null;
  }
}

export default async function JoinPage({ params }: PageProps) {
  const { token } = await params;

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const community = await getCommunityByToken(token, origin);

  if (!community) {
    redirect("/dashboard/communities");
  }

  return <JoinCommunityClient community={community} token={token} />;
}
