"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

// Auth pages render standalone (no chrome) so the login/register cards
// take the full viewport.
const AUTH_PATHS = new Set(["/login", "/register"]);

type NavItem = {
  href: string;
  label: string;
  // A page belongs to a section if the pathname startsWith the href
  // (so /portals/[id]/schema highlights "Portals"). Home is exact-match.
  exact?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Home", exact: true },
  { href: "/portals", label: "Portals" },
  { href: "/import", label: "Import" },
  { href: "/jobs", label: "Jobs" },
  { href: "/docs", label: "Docs" },
];

// Mono uppercase link, underlined on hover; the current section keeps a
// heavier underline. Same treatment as hubspot-site-auditor's header.
const LINK =
  "rounded font-mono text-xs font-bold tracking-[0.08em] uppercase whitespace-nowrap underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Top bar modeled on hubspot-site-auditor: cream, thin ink rule, wordmark +
// app label, mono text links, signed-in email + sign-out on the right.
// Under md the links drop to their own row.
export function Header({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  if (AUTH_PATHS.has(pathname)) return null;
  return (
    <header className="border-b border-foreground bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/saltedstone-logo.svg"
            alt="Salted Stone"
            width={110}
            height={32}
            className="h-8 w-auto dark:invert"
          />
          <span className="hidden border-l border-foreground pl-3 font-mono text-[11px] font-bold tracking-[0.08em] uppercase sm:inline">
            HubDB Importer
          </span>
        </Link>
        <nav
          aria-label="Primary"
          className="order-last w-full overflow-x-auto md:order-none md:w-auto md:flex-1"
        >
          <ul className="flex items-center gap-6">
            {ITEMS.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`${LINK} ${active ? "underline decoration-2" : ""}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {userEmail ? (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-56 truncate text-sm text-muted-foreground md:inline" title={userEmail}>
              {userEmail}
            </span>
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </header>
  );
}

// Ink footer bar, as in hubspot-site-auditor. Same width as the header.
export function Footer() {
  const pathname = usePathname();
  if (AUTH_PATHS.has(pathname)) return null;
  return (
    <footer className="bg-foreground text-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-5 font-mono text-[11px] font-bold tracking-[0.08em] uppercase">
        <span>Salted Stone · HubDB Importer</span>
        <span className="text-background/80">Relational imports into HubSpot HubDB</span>
      </div>
    </footer>
  );
}
