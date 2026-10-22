"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/db/supabase-browser";

type State = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "submitting" });
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      // Don't leak whether the email exists — Supabase already returns a
      // generic "Invalid login credentials" for wrong password AND unknown
      // email, so passing the message through is safe.
      setState({ kind: "error", message: error.message });
      return;
    }
    // Push to the intended destination; router.refresh() forces the server
    // components to re-render with the new session cookie visible.
    router.push(next);
    router.refresh();
  }

  const disabled = state.kind === "submitting";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="form-label">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          disabled={disabled}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@saltedstone.com"
          className="form-input mt-1"
        />
      </label>
      <label className="block">
        <span className="form-label">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          disabled={disabled}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="form-input mt-1"
        />
      </label>
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled} className="w-full">
        {state.kind === "submitting" ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
