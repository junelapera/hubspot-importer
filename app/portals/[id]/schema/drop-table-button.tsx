"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DropTableButton({
  portalId,
  tableId,
  tableLabel,
  portalEnv,
}: {
  portalId: string;
  tableId: string;
  tableLabel: string;
  portalEnv: "sandbox" | "production";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    const prompt =
      portalEnv === "production"
        ? `PRODUCTION portal — really drop "${tableLabel}"? This deletes every row and cannot be undone. Type the table name to confirm.`
        : `Drop "${tableLabel}"? This deletes the draft, live, and every row.`;
    if (portalEnv === "production") {
      const answer = window.prompt(prompt);
      if (answer !== tableLabel) {
        setError(answer == null ? null : "table name didn't match — cancelled");
        return;
      }
    } else {
      if (!window.confirm(prompt)) return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/tables/${tableId}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="destructive" size="sm" onClick={onClick} disabled={pending}>
        {pending ? "Dropping…" : "Drop table"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
