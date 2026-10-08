"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isProduction = portalEnv === "production";
  // Production drops require typing the table label — a single click on a
  // live portal is too easy to fat-finger.
  const canConfirm = !busy && (!isProduction || typed === tableLabel);

  function openDialog() {
    setTyped("");
    setError(null);
    setOpen(true);
  }

  async function onConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portals/${portalId}/tables/${tableId}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="destructive" size="sm" onClick={openDialog} disabled={pending}>
        {pending ? "Dropping…" : "Drop table"}
      </Button>
      {error && !open ? <span className="text-xs text-destructive">{error}</span> : null}

      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Drop &ldquo;{tableLabel}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {isProduction ? (
                <>
                  <strong className="text-destructive">Production portal.</strong> This deletes the draft, the
                  live table, and every row. Pages using this table break. This can&apos;t be undone.
                </>
              ) : (
                <>This deletes the draft, the live table, and every row. This can&apos;t be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isProduction ? (
            <label className="flex flex-col gap-1 text-xs">
              <span>
                Type <code className="rounded bg-muted px-1">{tableLabel}</code> to confirm
              </span>
              <input
                type="text"
                autoFocus
                autoComplete="off"
                className="h-9 rounded-md border px-3 text-sm"
                value={typed}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConfirm();
                }}
              />
            </label>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!canConfirm} onClick={onConfirm}>
              {busy ? "Dropping…" : "Drop table"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
