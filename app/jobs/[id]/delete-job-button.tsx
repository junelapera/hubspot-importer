"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteJobsRequest } from "../delete-jobs";
import { ConfirmDeleteDialog } from "../confirm-delete-dialog";

export function DeleteJobButton({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === "running";

  const [open, setOpen] = useState(false);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const { deleted } = await deleteJobsRequest([jobId]);
      setOpen(false);
      if (!deleted.includes(jobId)) {
        setError("Not deleted — the job started running. Cancel it first.");
        router.refresh();
        return;
      }
      router.push("/jobs");
      router.refresh();
    } catch (err) {
      setOpen(false);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="destructive"
        size="sm"
        disabled={running || busy}
        title={running ? "Cancel the run before deleting it" : undefined}
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" />
        {busy ? "Deleting…" : "Delete job"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        count={1}
        queued={status === "queued" ? 1 : 0}
        busy={busy}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
