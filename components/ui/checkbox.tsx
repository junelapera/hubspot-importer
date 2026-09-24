import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "cn";

// S2-branded checkbox. Uses a native <input type="checkbox"> under the hood
// (accessible for free — keyboard, screen reader, form participation) with
// its default appearance stripped via `appearance-none`. Custom check mark
// via a background SVG that recolors on `:checked` via CSS.
//
// Sizing matches the app's compact form controls (16px = size-4). Use
// `size-3.5` if you need a tighter fit inside a dense table row.
type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "peer size-4 shrink-0 appearance-none rounded-[4px] border border-input bg-background transition-colors",
          "checked:border-primary checked:bg-primary",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Check mark: inline SVG background, tinted via `--tw-content` on the
          // checked state. The trick is that background-image can't inherit
          // currentColor, so we ship two versions (transparent when unchecked,
          // primary-foreground when checked).
          "checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%223.5 8.5 6.5 11.5 12.5 5.5%22/></svg>')]",
          "checked:bg-center checked:bg-no-repeat",
          className,
        )}
        {...props}
      />
    );
  },
);
