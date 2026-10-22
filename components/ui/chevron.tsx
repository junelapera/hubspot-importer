import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// Inline separator for paths and mappings ("File › Share", "source › target").
// The icon is decorative; screen readers still hear the arrow it replaces.
export function Chevron() {
  return (
    <>
      <ChevronRight
        aria-hidden="true"
        className="mx-0.5 inline size-[1em] shrink-0 align-[-0.125em]"
      />
      <span className="sr-only"> → </span>
    </>
  );
}

// `items.join(" → ")` for JSX.
export function joinWithChevrons(items: readonly ReactNode[]): ReactNode {
  return items.map((item, i) => (
    <Fragment key={i}>
      {i > 0 ? <Chevron /> : null}
      {item}
    </Fragment>
  ));
}

// Renders plain text (error messages, row-error details, hints) with each
// arrow — `→`, `->`, or `›` between spaces — swapped for <Chevron />. Lets
// strings built server-side, and ones already saved on job rows, follow
// the no-arrows rule without changing what's stored or logged.
const ARROW = /\s+(?:→|->|›)\s+/;

export function withChevrons(text: string | null | undefined): ReactNode {
  if (!text) return text;
  const parts = text.split(ARROW);
  return parts.length === 1 ? text : joinWithChevrons(parts);
}
