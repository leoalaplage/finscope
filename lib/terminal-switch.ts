import { terminalHref } from "./term/command";

/**
 * FinScope is the terminal: every page of the former document site sends its
 * reader to the terminal's own screen for the same thing, query and anchor
 * kept — the front page to the launchpad, a company to its terminal screen,
 * the screener, compare, the DCF, the portfolio, the market, the settings
 * and the account to their twins. Pages with no twin (the former research
 * workspace, "return to my company") go to the launchpad. The status page,
 * the API and the assets are left alone.
 *
 * A temporary redirect (307), so a browser does not keep it for ever.
 */
const TO_LAUNCHPAD = new Set(["/", "/company", "/research"]);

export function terminalRedirect(pathname: string): string | null {
  if (pathname.startsWith("/t/") || pathname === "/t") return null;
  if (TO_LAUNCHPAD.has(pathname)) return "/t";
  return terminalHref(pathname);
}

/**
 * The site lives at tenqay.com: the Worker's own address and www lead there,
 * pages only — the API answers on every address, so the timer's own calls and
 * anything still pointed at the old address keep working.
 */
export const CANONICAL_HOST = "tenqay.com";

export function canonicalRedirect(url: URL): string | null {
  const elsewhere = url.hostname === `www.${CANONICAL_HOST}` || url.hostname.endsWith(".workers.dev");
  const path = terminalRedirect(url.pathname);
  if (elsewhere && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_next/")) {
    return `https://${CANONICAL_HOST}${path ?? url.pathname}${url.search}`;
  }
  return path ? `${url.origin}${path}${url.search}` : null;
}
