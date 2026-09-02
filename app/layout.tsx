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
  title: "FinScope — Simple, auditable financial research",
  description: "Research companies, compare financial metrics and build a traceable DCF in one focused workspace.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "FinScope — Auditable financial research",
    description: "Simple financial research you can trace.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "FinScope — Financials you can trace." }],
  },
  twitter: { card: "summary_large_image", title: "FinScope", description: "Simple financial research you can trace.", images: ["/og.png"] },
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
        {/*
          * The one typeface this interface owns.
          *
          * Everything here was set in the platform's own UI face, which is
          * what makes a page look assembled rather than designed: SF Pro on a
          * Mac is the font of every menu bar and every settings panel, and an
          * application set entirely in it has the visual authority of a
          * settings panel. Newsreader carries the headings and the company
          * names — an editorial serif, drawn for screens, which is the voice a
          * page of filed record should have. Every figure stays in the
          * grotesk, because figures have to line up in a column and a serif
          * does not do that as well.
          *
          * Preconnected so the two requests overlap the stylesheet, and
          * swapped so text is readable from the first paint.
          */}
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap"/>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }}/>
      </head>
      <body>{children}</body>
    </html>
  );
}
