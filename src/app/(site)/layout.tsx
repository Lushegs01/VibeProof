import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import "../globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { CommandPalette } from "@/components/layout/command-palette";
import { DemoBanner } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/demo/mode";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "VibeProof · Proof over ghost stories", template: "%s · VibeProof" },
  description:
    "VibeProof, the Haunt the Chain edition. Unearth contract data, creator history, product proof and onchain activity for vibe/vibe launches on Robinhood Chain.",
  openGraph: { siteName: "VibeProof", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#100d16", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface-3 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {isDemoMode() ? <DemoBanner /> : null}
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CommandPalette />
      </body>
    </html>
  );
}
