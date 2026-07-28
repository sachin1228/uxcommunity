"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateOnJoin } from "@/lib/communities/cache";
import { Lock, Globe2, Users, Loader2, Check, MessageSquare } from "lucide-react";

interface Community {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  is_private: boolean;
  description: string | null;
  member_count: number;
}

interface JoinCommunityClientProps {
  community: Community;
  token: string;
}

export function JoinCommunityClient({ community, token }: JoinCommunityClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "requested" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleJoin() {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/communities/join/${token}`, { method: "POST" });
      const data = await res.json().catch(() => null);

      if (res.status === 401) {
        // Not logged in — redirect to auth
        router.push(`/auth/login?redirect=${encodeURIComponent(`/join/${token}`)}`);
        return;
      }
      if (!res.ok) {
        setErrorMsg(data?.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }

      if (data.status === "already_member" || data.status === "joined") {
        invalidateOnJoin(data.communityId);
        setStatus("joined");
        setTimeout(() => {
          router.push(`/dashboard/communities/${data.communityId}`);
        }, 1200);
      } else if (data.status === "requested") {
        setStatus("requested");
      } else {
        invalidateOnJoin(data.communityId);
        setStatus("joined");
        setTimeout(() => {
          router.push(`/dashboard/communities/${data.communityId}`);
        }, 1200);
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  const avatarLetter = community.name.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-2xl">
        {/* Community avatar */}
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-raised text-foreground-muted">
          {community.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={community.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-2xl font-bold text-foreground">{avatarLetter}</span>
          )}
        </div>

        {/* Privacy badge */}
        <div className="mb-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-body text-xs text-foreground-muted">
            {community.is_private ? (
              <><Lock size={11} /> Private community</>
            ) : (
              <><Globe2 size={11} /> Public community</>
            )}
          </span>
        </div>

        {/* Name + description */}
        <h1 className="text-center font-display text-xl font-semibold text-foreground">
          {community.name}
        </h1>
        {community.description && (
          <p className="mt-2 text-center font-body text-sm leading-relaxed text-foreground-muted">
            {community.description}
          </p>
        )}

        {/* Member count */}
        <p className="mt-3 flex items-center justify-center gap-1.5 font-body text-xs text-foreground-subtle">
          <Users size={12} />
          {community.member_count.toLocaleString()} member{community.member_count !== 1 ? "s" : ""}
        </p>

        {/* CTA */}
        <div className="mt-7">
          {status === "joined" && (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-accent/10 py-3 text-accent">
              <Check size={16} />
              <span className="font-body text-sm font-medium">Joined! Redirecting…</span>
            </div>
          )}

          {status === "requested" && (
            <div className="rounded-xl border border-border bg-surface-raised p-4 text-center">
              <Check size={18} className="mx-auto mb-2 text-accent" />
              <p className="font-body text-sm font-semibold text-foreground">Request sent</p>
              <p className="mt-1 font-body text-xs text-foreground-muted">
                The community owner will review your request.
              </p>
            </div>
          )}

          {(status === "idle" || status === "loading" || status === "error") && (
            <>
              <button
                onClick={handleJoin}
                disabled={status === "loading"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-body text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "loading" ? (
                  <><Loader2 size={15} className="animate-spin" /> Joining…</>
                ) : community.is_private ? (
                  <><Lock size={14} /> Request to join</>
                ) : (
                  <><MessageSquare size={14} /> Join community</>
                )}
              </button>

              {status === "error" && errorMsg && (
                <p className="mt-3 text-center font-body text-xs text-red-400">{errorMsg}</p>
              )}

              <p className="mt-4 text-center font-body text-xs text-foreground-subtle">
                {community.is_private
                  ? "The owner will approve your request before you can access the community."
                  : "You'll get instant access after joining."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
