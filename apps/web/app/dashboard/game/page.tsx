import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Doodle District — Game" };

export default async function GamePage() {
  const session = await getSession();
  // The dashboard layout guarantees a signed-in user; email just gives the
  // game a sensible default player name ("alex" from alex@example.com).
  const name = session?.email?.split("@")[0] ?? "";

  return (
    <div className="h-full w-full bg-[#f6f3e6]">
      <iframe
        src={`/game/index.html${name ? `?name=${encodeURIComponent(name)}` : ""}`}
        title="Doodle District — play in the browser"
        className="h-full w-full border-0"
        allow="pointer-lock; fullscreen; autoplay; clipboard-write"
        allowFullScreen
      />
    </div>
  );
}