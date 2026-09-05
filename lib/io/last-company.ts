export const LAST_COMPANY_KEY = "finscope.lastCompany";

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/** A device-local company destination, or the watchlist when none is valid. */
export function companyReturnPath(saved: string | null): string {
  const ticker = saved?.trim().toUpperCase() ?? "";
  return TICKER.test(ticker) ? `/s/${encodeURIComponent(ticker)}` : "/";
}

export function rememberCompany(ticker: string) {
  if (typeof window === "undefined") return;
  const normalized = ticker.trim().toUpperCase();
  if (!TICKER.test(normalized)) return;
  try { localStorage.setItem(LAST_COMPANY_KEY, normalized); }
  catch { /* A blocked store only disables the shortcut; the company page remains usable. */ }
  /*
   * A write in this tab is not a storage event.
   *
   * The bar reads this memory to carry the company across to Compare and to the
   * DCF, and the browser only broadcasts a storage change to *other* tabs — so
   * without a word of our own the links in this one would keep pointing at
   * whatever was remembered when the page loaded.
   */
  try { window.dispatchEvent(new Event("finscope:last-company")); } catch { /* Nothing depends on it. */ }
}

export function lastCompanyPath(): string {
  if (typeof window === "undefined") return "/";
  try { return companyReturnPath(localStorage.getItem(LAST_COMPANY_KEY)); }
  catch { return "/"; }
}
