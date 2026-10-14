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
