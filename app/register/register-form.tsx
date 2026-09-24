"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "@/lib/auth/email-domain";

type State = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

const MIN_PASSWORD_LENGTH = 8;

export function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Client-side validation — for UX. Server re-validates everything.
    if (!isAllowedEmail(email)) {
      setState({
        kind: "error",
        message: `Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed.`,
      });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setState({
        kind: "error",
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    if (password !== confirm) {
      setState({ kind: "error", message: "Passwords don't match." });
      return;
    }

    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setState({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      // Server set the session cookies on the response — refresh to pick
      // them up in the server components + push to intended destination.
      router.push(next);
      router.refresh();
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  const disabled = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Work email</span>
        <input
          type="email"
          autoComplete="email"
          required
          disabled={disabled}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={disabled}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <span className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={disabled}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      {state.kind === "error" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled} className="w-full">
        {state.kind === "submitting" ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
