"use client";

import { useEffect, useState } from "react";
import { SECTIONS, type SectionId } from "./sections";

type Variant = "sidebar" | "inline";

export function DocsToc({ variant = "sidebar" }: { variant?: Variant }) {
  const active = useActiveSection();

  if (variant === "inline") {
    return (
      <nav
        aria-label="Guide sections"
        className="rounded-md border border-border bg-card p-3 lg:hidden"
      >
        <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "location" : undefined}
                className={
                  "underline-offset-2 hover:underline " +
                  (active === s.id ? "font-semibold text-primary" : "text-foreground/80")
                }
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Guide sections"
      className="hidden lg:block sticky top-8 self-start"
    >
      <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-2 text-sm">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? "location" : undefined}
              className={
                "block border-l-2 pl-3 py-0.5 transition-colors " +
                (active === s.id
                  ? "border-primary font-semibold text-primary"
                  : "border-border text-foreground/70 hover:border-foreground/40 hover:text-foreground")
              }
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function useActiveSection(): SectionId | null {
  const [active, setActive] = useState<SectionId | null>(null);

  useEffect(() => {
    const elements = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (elements.length === 0) return;

    // Fires when a section top crosses ~20% down from the viewport top —
    // matches the "you are here" intuition rather than "which section is
    // barely visible at the bottom".
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort(
          (a, b) => a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top,
        );
        setActive(visible[0].target.id as SectionId);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return active;
}
