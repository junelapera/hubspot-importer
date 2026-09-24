"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/db/supabase-browser";

// Client button that signs out via the browser Supabase client (clears
// the local session) AND hits /api/auth/logout (clears the server cookie
// via createServerClient's writeAll). Double-tap so both sides of the
// session are cleaned even if one path is somehow flaky.
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        "text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50 " +
        (className ?? "")
      }
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
