"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; label: string };

export function PortalForm() {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      label: String(form.get("label") ?? "").trim(),
      env: String(form.get("env") ?? "sandbox"),
      hubId: String(form.get("hubId") ?? "").trim() || null,
      token: String(form.get("token") ?? "").trim(),
    };
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as { portal?: { label: string }; error?: string };
      if (!res.ok) {
        setState({ kind: "error", message: payload.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ kind: "success", label: payload.portal?.label ?? body.label });
      e.currentTarget.reset();
      setEnv("sandbox");
      router.refresh();
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  const disabled = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" hint="e.g. `Acme sandbox`">
          <input
            name="label"
            required
            maxLength={100}
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
        <Field label="Environment">
          <input type="hidden" name="env" value={env} />
          <Select
            value={env}
            onValueChange={(v) => setEnv(v as "sandbox" | "production")}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">sandbox</SelectItem>
              <SelectItem value="production">production</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Hub ID (optional)" hint="Top-right of the HubSpot UI">
          <input
            name="hubId"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={20}
            disabled={disabled}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
        <Field label="Private-app token" hint="pat-…" full>
          <input
            name="token"
            type="password"
            required
            minLength={10}
            disabled={disabled}
            autoComplete="off"
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {state.kind === "submitting" ? "Validating…" : "Add portal"}
        </Button>
        {state.kind === "error" ? (
          <p className="text-sm text-destructive">{state.message}</p>
        ) : null}
        {state.kind === "success" ? (
          <p className="text-sm text-muted-foreground">Added {state.label}.</p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  full,
  children,
}: {
  label: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"flex flex-col gap-1 text-sm " + (full ? "sm:col-span-2" : "")}>
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
