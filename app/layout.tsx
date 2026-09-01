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
  title: "FinScope — See the business. Verify the numbers.",
  description: "Traceable financial research from SEC filings, matched market prices and explicit formulas.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "FinScope — See the business. Verify the numbers.",
    description: "Traceable financial research from SEC filings, matched market prices and explicit formulas.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "FinScope — See the business. Verify the numbers." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FinScope — See the business. Verify the numbers.",
    description: "Traceable financial research from SEC filings, matched market prices and explicit formulas.",
    images: ["/og.png"],
  },
};

/**
 * Reads the reader's saved choice and stamps it on the document.
 *
 * Kept as a string rather than a function so it can be inlined verbatim, and
 * deliberately silent on failure: a browser that refuses localStorage should
 * get the default theme, not an exception before the page has rendered.
 *
 * `<html>` carries `suppressHydrationWarning` for it. The attribute is changed
 * here before React hydrates, so the prerendered value and the live one
 * legitimately differ; React reports such an attribute as one it will not patch
 * up and keeps the client's — which is the outcome we want, leaving only a
 * console message to silence. The suppression covers that element's own
 * attributes and nothing below it.
 *
 * It sets the attribute and nothing else. Writing `style.colorScheme` here too
 * would add an inline style to `<html>` that the prerendered document does not
 * carry, which React reports as an attribute it will not patch up — and it is
 * redundant anyway: the stylesheet declares `color-scheme` for each theme, so
 * the attribute alone already switches it.
 */
const THEME_BOOT = `try{var t=localStorage.getItem("finscope.theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /*
     * The saved theme is applied before the first paint, and the default in
     * the markup is the one the application actually defaults to.
     *
     * The document was prerendered as `light` while the app defaults to dark,
     * so every visitor got a white page for as long as it took the bundle to
     * boot and an effect to run — and a reader who had chosen light got the
     * mismatch in the other direction. The script below is four statements and
     * runs before the body is parsed; it costs no Worker CPU, because this
     * document is a static asset.
     */
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }}/>
      </head>
      <body>{children}</body>
    </html>
  );
}
