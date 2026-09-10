export const LAST_COMPANY_KEY = "finscope.lastCompany";
export const RECENT_COMPANIES_KEY = "finscope.io.recent-companies.v1";
export const RECENT_COMPANIES_EVENT = "finscope:recent-companies";

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
  try {
    localStorage.setItem(LAST_COMPANY_KEY, normalized);
    const current = JSON.parse(localStorage.getItem(RECENT_COMPANIES_KEY) ?? "[]") as unknown;
    const valid = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string" && TICKER.test(item)) : [];
    localStorage.setItem(RECENT_COMPANIES_KEY, JSON.stringify([normalized, ...valid.filter((item) => item !== normalized)].slice(0, 8)));
  }
  catch { /* A blocked store only disables the shortcut; the company page remains usable. */ }
  /*
   * A write in this tab is not a storage event.
   *
   * The bar reads this memory to carry the company across to Compare and to the
   * DCF, and the browser only broadcasts a storage change to *other* tabs — so
   * without a word of our own the links in this one would keep pointing at
   * whatever was remembered when the page loaded.
   */
  try {
    window.dispatchEvent(new Event("finscope:last-company"));
    window.dispatchEvent(new Event(RECENT_COMPANIES_EVENT));
  } catch { /* Nothing depends on it. */ }
}

export function readRecentCompanies(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_COMPANIES_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && TICKER.test(item)).slice(0, 8) : [];
  } catch { return []; }
}

export function lastCompanyPath(): string {
  if (typeof window === "undefined") return "/";
  try { return companyReturnPath(localStorage.getItem(LAST_COMPANY_KEY)); }
  catch { return "/"; }
}
