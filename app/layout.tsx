import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MobileNav, Sidebar } from "./nav";
import { getCurrentUser } from "@/lib/db/supabase-server-auth";

const hankenSans = Hanken_Grotesk({
  variable: "--font-hanken-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "S2 HubDB Importer",
  description: "Import relational data into HubSpot HubDB with foreign-key resolution.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Server-side session read for the sidebar's "signed in as" block.
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
      className={`${hankenSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <Sidebar userEmail={userEmail} />
        <div className="flex min-h-screen flex-1 flex-col">
          <MobileNav />
          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
