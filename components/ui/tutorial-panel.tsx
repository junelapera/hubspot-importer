import type { ReactNode } from "react";

// Native <details>/<summary> disclosure. Collapsed by default so experienced
// users aren't scrolled past a wall of help text, but the "Show me how"
// affordance is obvious for first-timers. Uses brand-butter background +
// primary border so it reads as help, not error.
export function TutorialPanel({
  title = "New to this? Show me how",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-md border border-primary/40 bg-[color-mix(in_oklch,var(--color-brand-butter),var(--card)_50%)] p-4 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <span
          aria-hidden
          className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
        >
          ?
        </span>
        <span>{title}</span>
        <span aria-hidden className="ml-auto text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
        {children}
      </div>
    </details>
  );
}

// Numbered step list — keeps content consistent across tutorials.
export function TutorialSteps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

export function TutorialTip({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">Tip: </span>
      {children}
    </p>
  );
}
