import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ProfileClient } from "./ProfileClient";
import type { ProfileThread } from "@/components/communities/threads/types";

export const metadata = { title: "Your Profile" };

export default async function ProfilePage() {
  const session = await getSession();
  if (!session || session.role !== "user") redirect("/login");

  const db = createServiceClient();
  const userId = session.userId!;

  const [
    { data: user },
    { data: profile },
    { data: userInterests },
    { data: allInterests },
    { data: rawThreads },
  ] = await Promise.all([
    db.from("users").select("name, email, created_at").eq("id", userId).maybeSingle(),
    db
      .from("designer_profiles")
      .select(
        "avatar_url, avatar_source, experience_level, linkedin_url, portfolio_url, bio, cities(id, name), companies(id, name), design_sectors(id, name)"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("user_interests")
      .select("interest_id, design_interests(id, name, image_url)")
      .eq("user_id", userId),
    db.from("design_interests").select("id, name, image_url").eq("is_active", true).order("name"),
    db
      .from("community_threads")
      .select(
        "id, community_id, user_id, title, description, category, tags, attachments, links, allow_replies, created_at, updated_at, communities(name)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Compute real vote + comment counts so the profile page doesn't open with all zeros.
  const threadList = rawThreads ?? [];
  const threadIds = threadList.map((t) => t.id);

  const [{ data: allVotes }, { data: myVotes }, { data: mySaves }, { data: allComments }] = threadIds.length
    ? await Promise.all([
        db.from("thread_votes").select("thread_id").in("thread_id", threadIds),
        db.from("thread_votes").select("thread_id").in("thread_id", threadIds).eq("user_id", userId),
        db.from("thread_saves").select("thread_id").in("thread_id", threadIds).eq("user_id", userId),
        db.from("thread_comments").select("thread_id").in("thread_id", threadIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const voteCountMap: Record<string, number> = {};
  for (const v of allVotes ?? []) voteCountMap[v.thread_id] = (voteCountMap[v.thread_id] ?? 0) + 1;

  const commentCountMap: Record<string, number> = {};
  for (const c of allComments ?? []) commentCountMap[c.thread_id] = (commentCountMap[c.thread_id] ?? 0) + 1;

  const myVoteSet = new Set((myVotes ?? []).map((v) => v.thread_id));
  const mySaveSet = new Set((mySaves ?? []).map((s) => s.thread_id));

  // Supabase returns the joined communities row as an object (many-to-one),
  // not as an array. Normalise to { name } | null regardless of shape.
  function communityOf(thread: { communities?: unknown }): { name: string } | null {
    const raw = thread.communities;
    if (!raw) return null;
    if (Array.isArray(raw)) return (raw[0] as { name: string }) ?? null;
    return raw as { name: string };
  }

  const myInterestIds = (userInterests ?? [])
    .map((r: any) => r.design_interests?.id)
    .filter(Boolean) as string[];

  return (
    <ProfileClient
      initialName={user?.name ?? ""}
      email={user?.email ?? session.email ?? ""}
      createdAt={user?.created_at ?? ""}
      avatarUrl={(profile as any)?.avatar_url ?? null}
      avatarSource={(profile as any)?.avatar_source ?? null}
      city={(profile as any)?.cities?.name ?? null}
      company={(profile as any)?.companies?.name ?? null}
      sector={(profile as any)?.design_sectors?.name ?? null}
      experienceLevel={(profile as any)?.experience_level ?? null}
      initialLinkedIn={(profile as any)?.linkedin_url ?? ""}
      initialPortfolio={(profile as any)?.portfolio_url ?? ""}
      initialBio={(profile as any)?.bio ?? ""}
      initialInterestIds={myInterestIds}
      allInterests={(allInterests ?? []) as { id: string; name: string; image_url?: string | null }[]}
      initialThreads={threadList.map((thread) => ({
        ...thread,
        users: null,
        community: communityOf(thread),
        vote_count: voteCountMap[thread.id] ?? 0,
        user_voted: myVoteSet.has(thread.id),
        user_saved: mySaveSet.has(thread.id),
        comment_count: commentCountMap[thread.id] ?? 0,
      })) as ProfileThread[]}
      currentUserId={userId}
    />
  );
}
