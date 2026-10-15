import { fetchQuotes } from "./adapters/spark";
import { parseTreasuryCurves } from "./macro";
import { cachedJson } from "./market-cache";

/**
 * RATES: the Treasury yields and the dollar a desk watches through the day —
 * the 3-month, 2-year, 10-year and 30-year, the two spreads read from them
 * (2s10s, and 3m10y, the curve the Fed's own research watches) and the dollar
 * index, each against yesterday's close.
 *
 * Live from the Tradeweb quotes CNBC carries, which include the 2-year that no
 * Yahoo symbol quotes. Where they do not answer, the Treasury's own par curve
 * (one reading a day, dated) and Yahoo's dollar index stand in; a spread is
 * only ever drawn from two yields of the same source and moment.
 */

export interface RateRow {
  id: "US3M" | "US2Y" | "US10Y" | "US30Y" | "2s10s" | "3m10y" | "DXY";
  label: string;
  /** A yield in per cent, a spread in basis points, the dollar index as a level. */
  last: number | null;
  /** In basis points for a yield or a spread, in per cent for the dollar. */
  change: number | null;
  unit: "yield" | "spread" | "index";
}

export interface Rates { rows: RateRow[]; asOf: string | null; source: string; live: boolean }

const YIELDS: Array<{ id: RateRow["id"]; cnbc: string; treasury: string; label: string }> = [
  { id: "US3M", cnbc: "US3M", treasury: "3M", label: "3-month" },
  { id: "US2Y", cnbc: "US2Y", treasury: "2Y", label: "2-year" },
  { id: "US10Y", cnbc: "US10Y", treasury: "10Y", label: "10-year" },
  { id: "US30Y", cnbc: "US30Y", treasury: "30Y", label: "30-year" },
];

/** "4.734%" → 4.734; "-0.068" → -0.068; anything else → null. */
const figure = (text: unknown) => {
  if (typeof text !== "string" && typeof text !== "number") return null;
  const value = Number(String(text).replace(/[%,+\s]/g, ""));
  return Number.isFinite(value) ? value : null;
};

/** Pure: the yields (in per cent) and their moves (in points) into the table, spreads included. */
export function rateRows(yields: Partial<Record<RateRow["id"], { last: number | null; change: number | null }>>, dollar: { last: number | null; change: number | null } | null): RateRow[] {
  const round = (value: number | null, places: number) => (value == null ? null : Math.round(value * 10 ** places) / 10 ** places);
  const rows: RateRow[] = YIELDS.map((tenor) => {
    const reading = yields[tenor.id];
    return { id: tenor.id, label: tenor.label, last: round(reading?.last ?? null, 3), change: round(reading?.change == null ? null : reading.change * 100, 1), unit: "yield" };
  });
  const spread = (id: "2s10s" | "3m10y", label: string, short: RateRow["id"], long: RateRow["id"]): RateRow => {
    const a = yields[short], b = yields[long];
    const last = a?.last != null && b?.last != null ? (b.last - a.last) * 100 : null;
    const change = last != null && a?.change != null && b?.change != null ? (b.change - a.change) * 100 : null;
    return { id, label, last: round(last, 1), change: round(change, 1), unit: "spread" };
  };
  rows.push(spread("2s10s", "2s10s", "US2Y", "US10Y"), spread("3m10y", "3m10y", "US3M", "US10Y"));
  rows.push({ id: "DXY", label: "Dollar index", last: round(dollar?.last ?? null, 2), change: round(dollar?.change ?? null, 2), unit: "index" });
  return rows;
}

const AGENT = "Mozilla/5.0 Tenqay/1.0";

async function fromCnbc(): Promise<Rates | null> {
  const symbols = [...YIELDS.map((tenor) => tenor.cnbc), ".DXY"].join("|");
  const response = await fetch(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbols)}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`, { headers: { Accept: "application/json", "User-Agent": AGENT } });
  if (!response.ok) { await response.body?.cancel(); return null; }
  const quotes = (await response.json() as { FormattedQuoteResult?: { FormattedQuote?: Array<Record<string, unknown>> } }).FormattedQuoteResult?.FormattedQuote ?? [];
  const bySymbol = new Map(quotes.map((quote) => [String(quote.symbol), quote]));
  const yields: Partial<Record<RateRow["id"], { last: number | null; change: number | null }>> = {};
  for (const tenor of YIELDS) {
    const quote = bySymbol.get(tenor.cnbc);
    const last = figure(quote?.last);
    const previous = figure(quote?.previous_day_closing);
    if (last != null) yields[tenor.id] = { last, change: previous != null ? last - previous : figure(quote?.change) };
  }
  const dxy = bySymbol.get(".DXY");
  const dollarLast = figure(dxy?.last), dollarPrevious = figure(dxy?.previous_day_closing);
  const dollar = dollarLast != null ? { last: dollarLast, change: dollarPrevious ? (dollarLast / dollarPrevious - 1) * 100 : figure(dxy?.change_pct) } : null;
  if (yields.US2Y == null || yields.US10Y == null) return null;
  const times = [...bySymbol.values()].map((quote) => String(quote.last_time ?? "")).filter(Boolean).sort();
  return { rows: rateRows(yields, dollar), asOf: times.at(-1) ? new Date(times.at(-1)!).toISOString() : new Date().toISOString(), source: "Tradeweb via CNBC; change against the previous close", live: true };
}

async function fromTreasury(): Promise<Rates | null> {
  const year = new Date().getUTCFullYear();
  const curves = [];
  for (const each of new Date().getUTCMonth() === 0 ? [year - 1, year] : [year]) {
    const response = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${each}`, { headers: { Accept: "application/xml", "User-Agent": AGENT } });
    if (!response.ok) { await response.body?.cancel(); continue; }
    curves.push(...parseTreasuryCurves(await response.text()));
  }
  curves.sort((a, b) => a.date.localeCompare(b.date));
  const [before, now] = curves.slice(-2);
  if (!now) return null;
  const at = (curve: typeof now | undefined, label: string) => curve?.points.find((point) => point.label === label)?.value ?? null;
  const yields: Partial<Record<RateRow["id"], { last: number | null; change: number | null }>> = {};
  for (const tenor of YIELDS) {
    const last = at(now, tenor.treasury), previous = at(before, tenor.treasury);
    if (last != null) yields[tenor.id] = { last, change: previous != null ? last - previous : null };
  }
  const dollarQuote = (await fetchQuotes(["DX-Y.NYB"], (symbol) => symbol).catch(() => new Map())).get("DX-Y.NYB");
  const dollar = dollarQuote?.price != null ? { last: dollarQuote.price, change: dollarQuote.changePercent ?? null } : null;
  return { rows: rateRows(yields, dollar), asOf: now.date, source: `US Treasury par curve of ${now.date} against the day before; dollar index from ICE via Yahoo`, live: false };
}

/** Kept a minute: the quotes move through the day. */
export async function usRates(): Promise<Rates | null> {
  const { body } = await cachedJson("us-rates:v1", 60, async () => {
    try { const live = await fromCnbc(); if (live) return live; } catch { /* The Treasury's own reading stands in. */ }
    return fromTreasury();
  }, (value) => (value?.live ? "full" : value ? "partial" : "empty"));
  return JSON.parse(body) as Rates | null;
}
