import { CommunityPhoneCard } from "@/components/home/CommunityPhoneCard";
import { CreateCommunityCard } from "@/components/home/CreateCommunityCard";

export default function PhonePreviewPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto flex w-72 flex-col gap-4">
        <CreateCommunityCard />
        <CommunityPhoneCard />
      </div>
    </main>
  );
}
