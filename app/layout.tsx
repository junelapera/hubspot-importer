import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Footer, Header } from "./nav";
import { getCurrentUser } from "@/lib/db/supabase-server-auth";

const hankenSans = Hanken_Grotesk({
  variable: "--font-hanken-sans",
  subsets: ["latin"],
});

// Stand-in for New Spirit Condensed (see --font-heading in globals.css).
// Same setup as hubspot-site-auditor.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600"],
});

// The site's "sub-font": eyebrows, buttons, nav labels, and code.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "S2 HubDB Importer",
  description: "Import relational data into HubSpot HubDB with foreign-key resolution.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Server-side session read for the header's "signed in as" block.
  // Wrapped in try/catch because getCurrentUser throws when the auth env
  // vars aren't set (dev-mode fallback) — nav gracefully handles null.
  let userEmail: string | null = null;
  try {
    const user = await getCurrentUser();
    userEmail = user?.email ?? null;
  } catch {
    userEmail = null;
  }
  return (
    <html
      lang="en"
      className={`${hankenSans.variable} ${fraunces.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:border-2 focus:border-foreground focus:bg-accent focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:font-bold focus:uppercase"
        >
          Skip to content
        </a>
        <Header userEmail={userEmail} />
        <div id="main" className="flex-1">
          {children}
        </div>
        <Footer />
      </body>
    </html>
  );
}
