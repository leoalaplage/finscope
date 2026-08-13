import { z } from "zod";
import type { CompanyProfile, MarketBar, MarketFrequency, PricePoint } from "../types";

const YahooChartSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({ currency: z.string(), symbol: z.string() }),
      timestamp: z.array(z.number()).optional(),
      indicators: z.object({
        quote: z.array(z.object({
          open: z.array(z.number().nullable()).optional(), high: z.array(z.number().nullable()).optional(),
          low: z.array(z.number().nullable()).optional(), close: z.array(z.number().nullable()).optional(),
          volume: z.array(z.number().nullable()).optional(),
        })),
        adjclose: z.array(z.object({ adjclose: z.array(z.number().nullable()).optional() })).optional(),
      }),
    })).nullable(),
    error: z.unknown().nullable(),
  }),
});

export interface MarketSession {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number | null;
  adjustedClose: number | null;
  volume?: number | null;
}

function calendarDistance(left: string, right: string) {
  return Math.round(Math.abs(Date.parse(left) - Date.parse(right)) / 86_400_000);
}

export function matchHistoricalSession(
  sessions: MarketSession[],
  requestedDate: string,
  options: { previousDays?: number; nextDays?: number; preferAdjusted?: boolean } = {},
) {
  const previousDays = options.previousDays ?? 7;
  const nextDays = options.nextDays ?? 2;
  const valid = sessions.filter((session) => session.close != null || session.adjustedClose != null).sort((a, b) => a.date.localeCompare(b.date));
  const exact = valid.find((session) => session.date === requestedDate);
  const prior = [...valid].reverse().find((session) => session.date < requestedDate && calendarDistance(session.date, requestedDate) <= previousDays);
  const next = valid.find((session) => session.date > requestedDate && calendarDistance(session.date, requestedDate) <= nextDays);
  const session = exact ?? prior ?? next;
  if (!session) return null;
  const useAdjusted = (options.preferAdjusted ?? true) && session.adjustedClose != null;
  return {
    session,
    price: useAdjusted ? session.adjustedClose! : session.close!,
    type: useAdjusted ? "adjusted close" as const : "close" as const,
    fallback: exact ? "exact date" as const : prior ? "previous trading session" as const : "next trading session" as const,
    distanceDays: calendarDistance(session.date, requestedDate),
  };
}

export function resolveYahooTicker(company: Pick<CompanyProfile, "ticker" | "yahooTicker" | "tickerHistory">, date: string) {
  const historical = company.tickerHistory?.find((entry) => (!entry.from || date >= entry.from) && (!entry.to || date <= entry.to));
  return historical?.ticker ?? company.yahooTicker ?? company.ticker;
}

export async function fetchYahooSessions(ticker: string, startDate: string, endDate: string) {
  const start = Math.floor((Date.parse(startDate) - 9 * 86_400_000) / 1000);
  const end = Math.floor((Date.parse(endDate) + 5 * 86_400_000) / 1000);
  const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d&events=history%2Cdiv%2Csplits`;
  let lastStatus = 0;
  for (const base of [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" }, next: { revalidate: 86_400 } });
    lastStatus = response.status;
    if (!response.ok) continue;
    const parsed = YahooChartSchema.parse(await response.json());
    const result = parsed.chart.result?.[0];
    if (!result) continue;
    const quote = result.indicators.quote[0];
    const closes = quote?.close ?? [];
    const adjusted = result.indicators.adjclose?.[0]?.adjclose ?? [];
    const sessions = (result.timestamp ?? []).map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10), open: quote?.open?.[index] ?? null,
      high: quote?.high?.[index] ?? null, low: quote?.low?.[index] ?? null, close: closes[index] ?? null,
      adjustedClose: adjusted[index] ?? null, volume: quote?.volume?.[index] ?? null,
    }));
    return { sessions, currency: result.meta.currency, symbol: result.meta.symbol };
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}

export async function fetchYahooPrices(company: CompanyProfile, requestedDates: string[], previousDays = 7, nextDays = 2) {
  const dates = [...new Set(requestedDates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (!dates.length) return [];
  const groups = new Map<string, string[]>();
  for (const date of dates) {
    const ticker = resolveYahooTicker(company, date);
    groups.set(ticker, [...(groups.get(ticker) ?? []), date]);
  }
  const output: Array<{ requestedDate: string; point?: PricePoint; error?: string }> = [];
  for (const [ticker, tickerDates] of groups) {
    try {
      const payload = await fetchYahooSessions(ticker, tickerDates[0], tickerDates.at(-1)!);
      for (const requestedDate of tickerDates) {
        const match = matchHistoricalSession(payload.sessions, requestedDate, { previousDays, nextDays, preferAdjusted: false });
        if (!match) { output.push({ requestedDate, error: `No Yahoo Finance session found within ${previousDays} days before or ${nextDays} days after ${requestedDate}.` }); continue; }
        output.push({ requestedDate, point: {
          close: match.price, priceClose: match.price, totalReturnClose: match.session.adjustedClose,
          adjustedClose: match.session.adjustedClose, date: match.session.date, requestedDate,
          currency: payload.currency, ticker: payload.symbol, type: "split-adjusted close", fallback: match.fallback,
          distanceDays: match.distanceDays, sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history`,
        } });
      }
    } catch (error) {
      for (const requestedDate of tickerDates) output.push({ requestedDate, error: error instanceof Error ? error.message : "Price unavailable" });
    }
  }
  return output.sort((left, right) => left.requestedDate.localeCompare(right.requestedDate));
}

function bucketKey(date: string, frequency: MarketFrequency) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (frequency === "daily") return date;
  if (frequency === "annual") return date.slice(0, 4);
  if (frequency === "quarterly") return `${date.slice(0, 4)}-Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
  if (frequency === "monthly") return date.slice(0, 7);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Aggregates real trading sessions. Weekly bars are Monday-based and use the final session's closes. */
export function aggregateMarketSessions(sessions: MarketSession[], frequency: MarketFrequency): Omit<MarketBar, "currency" | "ticker" | "sourceUrl">[] {
  const groups = new Map<string, MarketSession[]>();
  for (const session of sessions.filter((item) => item.close != null).sort((a, b) => a.date.localeCompare(b.date))) {
    const key = bucketKey(session.date, frequency);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]; const last = items.at(-1)!;
    const highs = items.map((item) => item.high).filter((value): value is number => value != null);
    const lows = items.map((item) => item.low).filter((value): value is number => value != null);
    const volumes = items.map((item) => item.volume).filter((value): value is number => value != null);
    return { date: last.date, periodStart: first.date, open: first.open ?? first.close, high: highs.length ? Math.max(...highs) : null,
      low: lows.length ? Math.min(...lows) : null, close: last.close!, adjustedClose: last.adjustedClose,
      volume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) : null, frequency };
  });
}

export async function fetchYahooMarketHistory(company: CompanyProfile, startDate: string, endDate: string, frequency: MarketFrequency) {
  const ticker = resolveYahooTicker(company, endDate);
  const payload = await fetchYahooSessions(ticker, startDate, endDate);
  const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history`;
  return aggregateMarketSessions(payload.sessions.filter((session) => session.date >= startDate && session.date <= endDate), frequency)
    .map((bar): MarketBar => ({ ...bar, currency: payload.currency, ticker: payload.symbol, sourceUrl }));
}

export async function fetchYahooPrice(company: CompanyProfile, requestedDate: string, previousDays = 7, nextDays = 2): Promise<PricePoint> {
  const result = (await fetchYahooPrices(company, [requestedDate], previousDays, nextDays))[0];
  if (!result?.point) throw new Error(result?.error ?? "Price unavailable.");
  return result.point;
}
