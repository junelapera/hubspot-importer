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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-foreground bg-card p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/saltedstone-logo.svg"
          alt="Salted Stone"
          width={124}
          height={36}
          className="h-9 w-auto dark:invert"
        />
        <p className="eyebrow mt-3">HubDB Importer</p>
        <h1 className="mt-6 text-3xl font-medium leading-tight tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
            Use your <strong>@{ALLOWED_EMAIL_DOMAIN}</strong> account.
        </p>
        <div className="mt-6">
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Don&apos;t have an account yet?{" "}
          <Link
            href={`/register${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
          >
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
