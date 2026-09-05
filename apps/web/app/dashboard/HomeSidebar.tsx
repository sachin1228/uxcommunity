import Link from "next/link";
import {
  ArrowUpRight,
  Briefcase,
  Compass,
  Library,
  Plus,
  UserRound,
} from "lucide-react";

const links = [
  { href: "/dashboard/communities", label: "Explore communities", icon: Compass },
  { href: "/dashboard/library", label: "Saved resources", icon: Library },
  { href: "/dashboard/jobs", label: "Find UX jobs", icon: Briefcase },
];

const personalLinks = [
  { href: "/dashboard/profile", label: "Your profile", icon: UserRound },
];

export function HomeSidebar() {
  return (
    <aside
      aria-label="Homepage sidebar"
      className="hidden w-64 shrink-0 flex-col gap-4 xl:flex"
    >
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-body text-xs font-semibold uppercase tracking-widest text-foreground-muted">
          Discover
        </h2>
        <nav className="mt-3" aria-label="Homepage shortcuts">
          <ul className="flex flex-col gap-1">
            {links.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-body text-xs font-semibold uppercase tracking-widest text-foreground-muted">
          Your space
        </h2>
        <nav className="mt-3" aria-label="Personal shortcuts">
          <ul className="flex flex-col gap-1">
            {personalLinks.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2 font-body text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Icon size={16} strokeWidth={2.5} aria-hidden="true" />
                  <span className="flex-1">{label}</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-foreground">
          <Plus size={17} strokeWidth={2.5} aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-body text-sm font-semibold text-foreground">
          Start a community
        </h2>
        <p className="mt-1 font-body text-xs leading-5 text-foreground-muted">
          Bring designers together around a shared interest or goal.
        </p>
        <Link
          href="/dashboard/communities"
          className="mt-3 inline-flex items-center font-body text-xs font-semibold text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Get started
          <ArrowUpRight size={14} className="ml-1" aria-hidden="true" />
        </Link>
      </section>
    </aside>
  );
}
