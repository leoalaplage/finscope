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
}

export function lastCompanyPath(): string {
  if (typeof window === "undefined") return "/";
  try { return companyReturnPath(localStorage.getItem(LAST_COMPANY_KEY)); }
  catch { return "/"; }
}
