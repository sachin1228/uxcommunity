export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth protection is handled by:
  //  - middleware.ts  → redirects unauthenticated requests away from /admin/*
  //  - (protected)/layout.tsx → server-side guard for all pages except /admin/login
  // This top-level layout is intentionally a passthrough so /admin/login
  // does not trigger a redirect loop.
  return <>{children}</>;
}
