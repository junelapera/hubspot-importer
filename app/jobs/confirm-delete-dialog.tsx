"use client";

import { Trash2 } from "lucide-react";
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

// Delete confirmation shared by the /jobs list (single + bulk) and the
// /jobs/[id] button. Controlled: the caller owns `open` and runs the
// delete in `onConfirm`; the dialog stays open (buttons disabled) while
// `busy` so a slow request can't be double-submitted.
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  count,
  queued,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  queued: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const noun = count === 1 ? "job" : "jobs";
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>
            Delete {count === 1 ? "this job" : `${count} ${noun}`}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {queued > 0
              ? `${queued === count && count === 1 ? "Its" : `${queued} queued`} run${queued === 1 ? "" : "s"} will be dropped before starting. `
              : null}
            {count === 1 ? "The job's" : "The jobs'"} history, batch log, and row errors are removed. Rows already written to HubDB are
            not affected. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting…" : `Delete ${noun}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
