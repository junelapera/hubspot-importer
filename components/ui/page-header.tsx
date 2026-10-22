import type { ReactNode } from "react";

// Standard page header for every top-level route: display-serif h1 with an
// optional description, over a 1px ink rule.
export function PageHeader({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  // Optional trailing content (badges, buttons) rendered to the right of
  // the h1 in the same baseline row.
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3 border-b border-foreground pb-6">
      <div className="flex flex-wrap items-baseline gap-3">
        {/* Same h1 as hubspot-site-auditor. */}
        <h1 className="text-4xl font-medium leading-tight tracking-tight break-words text-foreground sm:text-5xl">
          {title}
        </h1>
        {children}
      </div>
      {description ? (
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}
