import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "FinScope — Simple, auditable financial research",
    description: "Research companies, compare financial metrics and build a traceable DCF in one focused workspace.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "FinScope — Auditable financial research",
      description: "Simple financial research you can trace.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "FinScope — Financials you can trace." }],
    },
    twitter: { card: "summary_large_image", title: "FinScope", description: "Simple financial research you can trace.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
