import { friendlyError } from "@/lib/error-copy";

export function ErrorCard({
  error,
  className = "",
}: {
  error: unknown;
  className?: string;
}) {
  const { title, detail, hint, raw } = friendlyError(error);
  const showRawInline = detail && detail !== raw;
  return (
    <section
      role="alert"
      className={`space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm ${className}`}
    >
      <p className="font-semibold text-destructive">{title}</p>
      {detail ? <p className="text-destructive/90">{detail}</p> : null}
      {hint ? (
        <p className="text-sm text-foreground">
          <span className="font-medium">Fix: </span>
          {hint}
        </p>
      ) : null}
      {!showRawInline ? null : (
        <details className="text-xs text-destructive/70">
          <summary className="cursor-pointer">Raw error</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{raw}</pre>
        </details>
      )}
    </section>
  );
}
