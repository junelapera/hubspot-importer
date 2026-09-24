"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { LogoutButton } from "./logout-button";

// Auth pages render standalone (no chrome) so the login/register cards
// take the full viewport. Sidebar + MobileNav both bail early on these
// pathnames.
const AUTH_PATHS = new Set(["/login", "/register"]);

type NavItem = {
  href: string;
  label: string;
  icon: string;
  // Active-state background color from the S2 brand palette (defined in
  // globals.css as --color-brand-*). Each nav item gets its own so the
  // sidebar reads as a mini map of the app — Home = ochre (primary),
  // Portals = purple (integrations), Import = grass (action / go),
  // Jobs = burgundy (history), Docs = navy (informational).
  activeBg: string;
  // A page belongs to a section if the pathname startsWith the href
  // (so /portals/[id]/schema highlights "Portals"). Home is exact-match.
  exact?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "/icons/laptop.svg", exact: true, activeBg: "var(--color-brand-ochre)" },
  { href: "/portals", label: "Portals", icon: "/icons/compensation.svg", activeBg: "var(--color-brand-purple)" },
  { href: "/import", label: "Import", icon: "/icons/hubspot-expertise.svg", activeBg: "var(--color-brand-grass)" },
  { href: "/jobs", label: "Jobs", icon: "/icons/custom-solutions.svg", activeBg: "var(--color-brand-burgundy)" },
  { href: "/docs", label: "Docs", icon: "/icons/team-building.svg", activeBg: "var(--color-brand-navy)" },
];

// CSS mask lets the flat-colored Saltedstone SVGs inherit `currentColor`
// so the icon flips between forest / offwhite depending on active state,
// with no per-mode filter juggling.
function iconMaskStyle(src: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${src})`,
    maskImage: `url(${src})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  if (AUTH_PATHS.has(pathname)) return null;
  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border md:bg-muted/30 md:sticky md:top-0 md:h-screen md:shrink-0"
    >
      <div className="px-4 py-5 space-y-3 border-b border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/saltedstone-logo.svg"
          alt="Saltedstone"
          className="h-6 w-auto dark:invert"
        />
        <p className="text-sm font-semibold">S2 HubDB Importer</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  style={active ? { backgroundColor: item.activeBg } : undefined}
                  className={
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors " +
                    (active
                      ? "text-background"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground")
                  }
                >
                  <span
                    aria-hidden
                    className="size-5 bg-current shrink-0"
                    style={iconMaskStyle(item.icon)}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {userEmail ? (
        <div className="space-y-1 border-t border-border p-3 text-xs">
          <p className="truncate font-medium text-foreground" title={userEmail}>
            {userEmail}
          </p>
          <LogoutButton />
        </div>
      ) : null}
      <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
        <a
          href="https://github.com/junelapera/hubspot-importer"
          className="underline-offset-2 hover:underline"
        >
          github.com/junelapera/hubspot-importer
        </a>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  if (AUTH_PATHS.has(pathname)) return null;
  return (
    <nav
      aria-label="Primary"
      className="md:hidden sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-border bg-background/95 px-3 py-2 backdrop-blur"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            style={active ? { backgroundColor: item.activeBg } : undefined}
            className={
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors " +
              (active
                ? "text-background"
                : "text-foreground/80 hover:bg-muted")
            }
          >
            <span
              aria-hidden
              className="size-3.5 bg-current shrink-0"
              style={iconMaskStyle(item.icon)}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
