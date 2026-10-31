"use client";

import { Topbar } from "@/app/dashboard/Topbar";

export default function Page() {
  return (
    <div className="flex h-screen flex-col">
      <Topbar
        userId="preview"
        user={{ name: "sachin patil", email: "patilsachin1228@gmail.com", avatarUrl: null }}
      />
    </div>
  );
}
