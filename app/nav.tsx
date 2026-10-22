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
  // A page belongs to a section if the pathname startsWith the href
  // (so /portals/[id]/schema highlights "Portals"). Home is exact-match.
  exact?: boolean;
};

// Chrome follows saltedstone.com's header: ochre bar, forest mono labels,
// active item as an offwhite pill with a forest border (the site's
// badge-button). Per-section accent colors live on PageHeader instead.
const ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "/icons/laptop.svg", exact: true },
  { href: "/portals", label: "Portals", icon: "/icons/compensation.svg" },
  { href: "/import", label: "Import", icon: "/icons/hubspot-expertise.svg" },
  { href: "/jobs", label: "Jobs", icon: "/icons/custom-solutions.svg" },
  { href: "/docs", label: "Docs", icon: "/icons/team-building.svg" },
];

const ITEM_BASE =
  "flex items-center rounded-full border-2 font-mono font-bold uppercase tracking-[0.05em] transition-all";
const ITEM_ACTIVE = "border-foreground bg-background text-foreground";
const ITEM_IDLE =
  "border-transparent text-foreground hover:border-foreground hover:bg-foreground hover:text-background";

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
      className="hidden md:flex md:w-60 md:flex-col md:border-r-2 md:border-sidebar-border md:bg-sidebar md:text-sidebar-foreground md:sticky md:top-0 md:h-screen md:shrink-0"
    >
      <div className="px-5 py-6 space-y-3 border-b-2 border-sidebar-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/saltedstone-logo.svg"
          alt="Saltedstone"
          className="h-6 w-auto dark:invert"
        />
        <p className="eyebrow">HubDB Importer</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1.5">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${ITEM_BASE} gap-2.5 px-3 py-1.5 text-xs ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
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
        <div className="space-y-1 border-t-2 border-sidebar-border px-5 py-3 text-xs">
          <p className="truncate font-medium" title={userEmail}>
            {userEmail}
          </p>
          <LogoutButton className="text-foreground!" />
        </div>
      ) : null}
      <div className="border-t-2 border-sidebar-border px-5 py-3 text-[11px]">
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
      className="md:hidden sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b-2 border-sidebar-border bg-sidebar px-3 py-2"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${ITEM_BASE} gap-1.5 px-2.5 py-1 text-[11px] whitespace-nowrap ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
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
