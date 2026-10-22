import type { CSSProperties, ReactNode } from "react";

// Standard page header that ties each top-level route to its accent
// color. Renders the sidebar icon at 48px in the accent color to the left
// of the h1 so each section reads as themed.
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
    <header className="flex items-start gap-5 border-b-2 border-foreground pb-6">
      <span
        aria-hidden
        className="mt-1 size-12 shrink-0"
        style={iconMaskStyle(icon, accentColor)}
      />
      <div className="flex-1 space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          {/* saltedstone.com h1: condensed display serif, forest, tight
              leading. The accent color stays on the icon. */}
          <h1 className="text-4xl font-medium leading-[0.95] text-foreground md:text-5xl">
            {title}
          </h1>
          {children}
        </div>
        {description ? (
          <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">{description}</p>
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
