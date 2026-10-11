/**
 * The Settings tree's shared frame — one centred, max-width column so the
 * index and every drill-down page line up, and each page owns only its own
 * heading and back link.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto mt-8 max-w-3xl px-4 pb-12">{children}</div>;
}
