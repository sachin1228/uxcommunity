"use client";

import { useEffect } from "react";
import { initializeBrowserNotifications } from "@/lib/communities/message-notifications";

export function BrowserNotificationInitializer() {
  useEffect(() => {
    void initializeBrowserNotifications();
  }, []);

  return null;
}
