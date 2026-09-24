import type { CSSProperties, ReactNode } from "react";

// Standard page header that ties each top-level route to the nav item's
// accent color. Renders the sidebar icon at 40px in the accent color to
// the left of the h1, so the visual identity is consistent (sidebar chip
// → page header) and each section reads as themed.
export function PageHeader({
  icon,
  accentColor,
  title,
  description,
  children,
}: {
  icon: string;
  // CSS color expression, typically var(--color-brand-*).
  accentColor: string;
  title: ReactNode;
  description?: ReactNode;
  // Optional trailing content (badges, buttons) rendered to the right of
  // the h1 in the same baseline row.
  children?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-4">
      <span
        aria-hidden
        className="mt-1 size-10 shrink-0"
        style={iconMaskStyle(icon, accentColor)}
      />
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: accentColor }}>
            {title}
          </h1>
          {children}
        </div>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </header>
  );
}

function iconMaskStyle(src: string, color: string): CSSProperties {
  return {
    backgroundColor: color,
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

// Palette shortcuts keyed to the nav items in app/nav.tsx. Change this in
// one place if the palette shifts.
export const PAGE_ACCENTS = {
  home: { icon: "/icons/laptop.svg", color: "var(--color-brand-ochre)" },
  portals: { icon: "/icons/compensation.svg", color: "var(--color-brand-purple)" },
  import: { icon: "/icons/hubspot-expertise.svg", color: "var(--color-brand-grass)" },
  jobs: { icon: "/icons/custom-solutions.svg", color: "var(--color-brand-burgundy)" },
  docs: { icon: "/icons/team-building.svg", color: "var(--color-brand-navy)" },
} as const;
