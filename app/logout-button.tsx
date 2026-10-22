"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";

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
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={busy}
      className={"h-8 px-3 text-[11px] " + (className ?? "")}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
