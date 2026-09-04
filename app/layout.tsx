import type { Metadata } from "next";

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

const TITLE = "FinScope.io — Every US filer. Every filed figure.";
const DESCRIPTION = "Filed financials, market prices and valuation for any US-listed company, read from SEC XBRL.";

/**
 * No stylesheet is imported here.
 *
 * A root layout's CSS is every route's CSS, and the two halves of this
 * application do not share a design: the research workspace carries eighteen
 * hundred lines of it and FinScope.io carries a few hundred that contradict
 * them. Each imports its own, so a reader who opens a company page downloads
 * and parses none of the workspace's.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
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
