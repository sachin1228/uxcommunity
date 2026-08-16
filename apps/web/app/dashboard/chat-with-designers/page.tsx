import { DesignersRoomView } from "@/components/designers/DesignersRoom";

export const metadata = {
  title: "Chat with designers",
};

export default function ChatWithDesignersPage() {
  return (
    <div className="h-full">
      <DesignersRoomView />
    </div>
  );
}
