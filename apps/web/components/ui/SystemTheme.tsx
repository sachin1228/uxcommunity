"use client";

import { useEffect } from "react";

export function SystemTheme() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => document.documentElement.classList.toggle("dark", preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return null;
}
