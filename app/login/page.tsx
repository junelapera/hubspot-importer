import Link from "next/link";
import { LoginForm } from "./login-form";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/email-domain";

export const metadata = {
  title: "Sign in · S2 HubDB Importer",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="space-y-6 rounded-md border border-border bg-card p-8">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">S2 HubDB Importer</p>
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your <strong>@{ALLOWED_EMAIL_DOMAIN}</strong> account.
          </p>
        </header>
        <LoginForm next={next} />
        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          Don&apos;t have an account yet?{" "}
          <Link
            href={`/register${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
