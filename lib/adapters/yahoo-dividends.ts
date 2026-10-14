/**
 * Every cash dividend a listing has gone ex on, from Yahoo's chart history:
 * the date and the amount a share, split-adjusted, twenty-five years of them.
 * One request a company; read for NYSE and Nasdaq listings alike, which the
 * exchange calendars this site reads elsewhere are not.
 */
export interface DividendPayment { date: string; amount: number }

const BASES = () => [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

export async function fetchDividendHistory(symbol: string, years = 25): Promise<{ payments: DividendPayment[]; currency: string | null }> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - Math.round(years * 365.25 * 86_400);
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1wk&events=div%2Csplits`;
  let status = 0;
  for (const base of BASES()) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" } });
    status = response.status;
    if (!response.ok) { await response.body?.cancel(); continue; }
    const body = await response.json() as { chart?: { result?: Array<{ meta?: { currency?: string }; events?: { dividends?: Record<string, { amount?: number; date?: number }> } }> } };
    const result = body.chart?.result?.[0];
    if (!result) continue;
    const payments = Object.values(result.events?.dividends ?? {})
      .filter((entry): entry is { amount: number; date: number } => typeof entry.amount === "number" && entry.amount > 0 && typeof entry.date === "number")
      .map((entry) => ({ date: new Date(entry.date * 1000).toISOString().slice(0, 10), amount: entry.amount }))
      .sort((left, right) => left.date.localeCompare(right.date));
    return { payments, currency: result.meta?.currency ?? null };
  }
  throw new Error(`Yahoo Finance returned ${status || "no response"}.`);
}
