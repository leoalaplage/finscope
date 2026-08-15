import type { Metadata } from "next";
import "./globals.css";

/**
 * The canonical origin, as a constant.
 *
 * This used to be read from the request headers so the Open Graph image could
 * carry an absolute URL. That one call made the layout dynamic, and a dynamic
 * layout makes every page under it dynamic: the home page — which takes no
 * input and renders a constant — was being server-rendered inside the Worker on
 * every single visit. When the platform throttles CPU that is the request that
 * fails, and the site answered "Worker exceeded resource limits" instead of
 * loading. A social preview URL is not worth the front page.
 */
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://finscope-financial-research.leoalaplage.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "AapWire — Quality stock research",
  description: "Research quality companies, compare their numbers and build a traceable DCF, from official filings.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "AapWire — Quality stock research",
    description: "Quality stock research you can trace.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "AapWire — Financials you can trace." }],
  },
  twitter: { card: "summary_large_image", title: "AapWire", description: "Quality stock research you can trace.", images: ["/og.png"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
