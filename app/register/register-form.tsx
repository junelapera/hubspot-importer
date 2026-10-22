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
      <label className="block">
        <span className="form-label">Work email</span>
        <input
          type="email"
          autoComplete="email"
          required
          disabled={disabled}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
          className="form-input mt-1"
        />
      </label>
      <label className="block">
        <span className="form-label">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={disabled}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="form-input mt-1"
        />
        <span className="mt-1 block text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </label>
      <label className="block">
        <span className="form-label">Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={disabled}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="form-input mt-1"
        />
      </label>
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled} className="w-full">
        {state.kind === "submitting" ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
