"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Server,
  Upload,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  // A page belongs to a section if the pathname startsWith the href
  // (so /portals/[id]/schema highlights "Portals"). Home is exact-match.
  exact?: boolean;
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/portals", label: "Portals", icon: Server },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/jobs", label: "Jobs", icon: ListChecks },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border md:bg-muted/30 md:sticky md:top-0 md:h-screen md:shrink-0"
    >
      <div className="px-4 py-5 space-y-1 border-b border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Phase 1 · MVP</p>
        <p className="text-sm font-semibold">HubDB Importer</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-foreground text-background"
                      : "text-foreground/80 hover:bg-muted hover:text-foreground")
                  }
                >
                  <Icon className="size-4" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
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
  return (
    <nav
      aria-label="Primary"
      className="md:hidden sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-border bg-background/95 px-3 py-2 backdrop-blur"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors " +
              (active
                ? "bg-foreground text-background"
                : "text-foreground/80 hover:bg-muted")
            }
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
