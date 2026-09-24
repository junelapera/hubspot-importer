import Link from "next/link";
import { RegisterForm } from "./register-form";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/email-domain";

export const metadata = {
  title: "Register · S2 HubDB Importer",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/saltedstone-logo.svg"
          alt="Saltedstone"
          className="h-8 w-auto dark:invert"
        />
      </div>
      <div className="space-y-6 rounded-md border border-border bg-card p-8">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">S2 HubDB Importer</p>
          <h1 className="text-2xl font-semibold">Create an account</h1>
          <p className="text-sm text-muted-foreground">
            Only <strong>@{ALLOWED_EMAIL_DOMAIN}</strong> addresses can register.
          </p>
        </header>
        <RegisterForm next={next} />
        <p className="border-t border-border pt-4 text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
