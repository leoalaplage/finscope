import type { FilingEvent } from "./adapters/filing-events";
import type { InsiderPurchase } from "./insider-buying";

/**
 * What changed for the companies a reader follows: results published, reports
 * filed, a director or officer arriving or leaving, a red flag, an insider
 * buying. Built from the filings (lib/company-events.ts) and the index's
 * Form 4 purchases (lib/insider-buying.ts); the price alerts are the
 * browser's, against the reader's own notes (components/io/Alerts.tsx).
 *
 * Pure.
 */
export type AlertKind = "results" | "report" | "leadership" | "flag" | "insider" | "deal";

export interface Alert {
  ticker: string;
  kind: AlertKind;
  /** When it happened: the filing's acceptance, or the trade's date. */
  at: string;
  title: string;
  detail: string | null;
  url: string;
}

/** The events of one company since a date that a holder would want to hear about. */
export function filingAlerts(ticker: string, events: FilingEvent[], since: string): Alert[] {
  return events.flatMap((event): Alert[] => {
    const at = event.accepted ?? event.date;
    if (at.slice(0, 10) < since) return [];
    const codes = event.items.map((item) => item.code);
    const base = { ticker, at, url: event.url };
    if (event.flag) return [{ ...base, kind: "flag", title: event.items.filter((item) => item.flag).map((item) => item.label).join(" · "), detail: event.form }];
    if (codes.includes("2.02")) return [{ ...base, kind: "results", title: "Results published", detail: event.form }];
    if (/^10-[KQ]/.test(event.form) || /^20-F|^40-F/.test(event.form)) return [{ ...base, kind: "report", title: event.items[0].label, detail: event.form }];
    if (codes.includes("5.02")) return [{ ...base, kind: "leadership", title: "Director or officer change", detail: event.form }];
    if (codes.some((code) => code === "1.01" || code === "2.01") || /13D|TO-T|DEFM14A|S-4/.test(event.form)) return [{ ...base, kind: "deal", title: event.items.map((item) => item.label).join(" · "), detail: event.form }];
    return [];
  });
}

export function insiderAlerts(purchases: InsiderPurchase[], tickers: Set<string>, since: string): Alert[] {
  return purchases.filter((purchase) => tickers.has(purchase.ticker) && purchase.filed >= since).map((purchase) => ({
    ticker: purchase.ticker, kind: "insider" as const, at: purchase.filed,
    title: `${purchase.owner} bought`,
    detail: `${purchase.role}${purchase.value != null ? ` · $${Math.round(purchase.value).toLocaleString("en-US")}` : ""}`,
    url: purchase.url,
  }));
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((left, right) => right.at.localeCompare(left.at));
}
