"use client";

import { Spinner } from "@/components/ui/Spinner";
import { useState } from "react";

const PROJECT_URL = "https://example.com";

export function CustomView({ communityId }: { communityId: string; currentUserId: string }) {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size={28} />
        </div>
      )}
      <iframe
        src={PROJECT_URL}
        title="Custom Project"
        className={`flex-1 w-full border-0 ${loading ? "hidden" : ""}`}
        onLoad={() => setLoading(false)}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  );
}
