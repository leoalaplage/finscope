import { cachedJson } from "./market-cache";
import type { UniverseMember } from "./universe";

/**
 * Every operating company listed on the NYSE or Nasdaq that files with the
 * SEC, from the SEC's own list of tickers and exchanges: what the screener,
 * the peers and the insider record read beyond the S&P 500.
 *
 * One ticker a filer — the common stock, not its preferred shares, warrants
 * or units — and no fund: an ETF or a closed-end fund has no income statement
 * to score. About 5,400 companies in October 2026.
 *
 * The thousand largest by market value stand in for the Russell 1000: the
 * index's own list is FTSE Russell's and not published for free, and a
 * company's market value is what the index is built on.
 */

export { isScope, SCOPES, type Scope } from "./scopes";

interface ExchangeList { fields: string[]; data: Array<Array<string | number | null>> }

const SEC_AGENT = () => process.env.SEC_USER_AGENT || "Tenqay research application contact@example.com";
/** A preferred share, a warrant, a right or a unit: the filer's other listings, not its common stock. */
const NOT_COMMON = /[-.](W|WS|WT|U|UN|R|RT|P[A-Z]?)$|^[A-Z]{4}[WRU]$/;
/** An investment product, by its name: never a company with statements to score. */
const FUND_NAME = /\b(ETF|ETN|FUND|FUNDS|PORTFOLIO|INDEX|ISHARES|SPDR|PROSHARES|DIREXION|INVESCO DB|MUNICIPAL|INCOME TRUST|ACQUISITION CORP)\b/i;

/** The list, kept a day: the SEC adds a few tickers a week. */
export async function listedCompanies(): Promise<UniverseMember[]> {
  const { body } = await cachedJson<UniverseMember[]>("listed-companies:v1", 86_400, async () => {
    const [exchanges, funds] = await Promise.all([
      fetch("https://www.sec.gov/files/company_tickers_exchange.json", { headers: { "User-Agent": SEC_AGENT() } }).then((response) => (response.ok ? response.json() as Promise<ExchangeList> : null)),
      fetch("https://www.sec.gov/files/company_tickers_mf.json", { headers: { "User-Agent": SEC_AGENT() } }).then((response) => (response.ok ? response.json() as Promise<ExchangeList> : null)),
    ]);
    if (!exchanges) throw new Error("The SEC's list of listed companies could not be read.");
    return listedFrom(exchanges, new Set((funds?.data ?? []).map((row) => Number(row[0]))));
  }, (value) => (value.length > 3000 ? "full" : "empty"));
  return JSON.parse(body) as UniverseMember[];
}

/** Pure: the SEC's table to one common-stock listing a filer, funds and SPACs left out. */
export function listedFrom(table: ExchangeList, fundCiks: Set<number>): UniverseMember[] {
  const at = (name: string) => table.fields.indexOf(name);
  const [cikAt, nameAt, tickerAt, exchangeAt] = [at("cik"), at("name"), at("ticker"), at("exchange")];
  const byCik = new Map<number, UniverseMember>();
  for (const row of table.data) {
    const exchange = String(row[exchangeAt] ?? "");
    if (exchange !== "NYSE" && exchange !== "Nasdaq") continue;
    const cik = Number(row[cikAt]);
    const ticker = String(row[tickerAt] ?? "").toUpperCase();
    const name = String(row[nameAt] ?? "");
    if (!cik || !ticker || fundCiks.has(cik) || FUND_NAME.test(name) || NOT_COMMON.test(ticker)) continue;
    const member = { ticker: ticker.replace(/-/g, "."), cik: String(cik).padStart(10, "0"), name };
    const held = byCik.get(cik);
    // A filer's common stock is its shortest symbol; its other classes and listings are the same company.
    if (!held || member.ticker.length < held.ticker.length) byCik.set(cik, member);
  }
  return [...byCik.values()].sort((left, right) => left.ticker.localeCompare(right.ticker));
}

/** The `size` largest by market value, from rows that have a price and a share count. */
export function largest<T extends { ticker: string }>(rows: T[], marketValue: (row: T) => number | null, size = 1000): Set<string> {
  return new Set(rows.map((row) => ({ ticker: row.ticker, value: marketValue(row) }))
    .filter((entry): entry is { ticker: string; value: number } => entry.value != null && Number.isFinite(entry.value) && entry.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, size)
    .map((entry) => entry.ticker));
}

/**
 * The market value of every listed stock, from Nasdaq's public screener, kept
 * a day: only the order the timer builds companies in, so the thousand largest
 * are read first. Never shown — the screener's own market value is the
 * filings' share count times the price.
 */
export async function marketValues(): Promise<Record<string, number>> {
  const { body } = await cachedJson<Record<string, number>>("listed-market-values:v1", 86_400, async () => {
    const response = await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
    });
    if (!response.ok) { await response.body?.cancel(); return {}; }
    const rows = ((await response.json()) as { data?: { rows?: Array<{ symbol?: string; marketCap?: string }> } }).data?.rows ?? [];
    return Object.fromEntries(rows.flatMap((row) => {
      const value = Number(row.marketCap);
      return row.symbol && Number.isFinite(value) && value > 0 ? [[row.symbol.toUpperCase().replace(/\//g, "."), value]] : [];
    }));
  }, (value) => (Object.keys(value).length > 1000 ? "full" : "empty"));
  return JSON.parse(body) as Record<string, number>;
}
