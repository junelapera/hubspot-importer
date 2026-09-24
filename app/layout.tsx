import type { Metadata } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MobileNav, Sidebar } from "./nav";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${hankenSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <MobileNav />
          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
