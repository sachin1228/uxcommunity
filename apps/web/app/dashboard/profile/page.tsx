import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ProfileClient } from "./ProfileClient";

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
  ]);

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
    />
  );
}
