import { z } from "zod";
import type { CompanyProfile, PricePoint } from "../types";

const YahooChartSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({ currency: z.string(), symbol: z.string() }),
      timestamp: z.array(z.number()).optional(),
      indicators: z.object({
        quote: z.array(z.object({ close: z.array(z.number().nullable()).optional() })),
        adjclose: z.array(z.object({ adjclose: z.array(z.number().nullable()).optional() })).optional(),
      }),
    })).nullable(),
    error: z.unknown().nullable(),
  }),
});

export interface MarketSession {
  date: string;
  close: number | null;
  adjustedClose: number | null;
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

export async function fetchYahooPrice(company: CompanyProfile, requestedDate: string, previousDays = 7, nextDays = 2): Promise<PricePoint> {
  const ticker = resolveYahooTicker(company, requestedDate);
  const start = Math.floor((Date.parse(requestedDate) - (previousDays + 2) * 86_400_000) / 1000);
  const end = Math.floor((Date.parse(requestedDate) + (nextDays + 2) * 86_400_000) / 1000);
  const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d&events=history%2Cdiv%2Csplits`;
  let lastStatus = 0;
  for (const base of [process.env.YAHOO_FINANCE_BASE_URL || "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 FinScope/1.0" }, next: { revalidate: 86_400 } });
    lastStatus = response.status;
    if (!response.ok) continue;
    const parsed = YahooChartSchema.parse(await response.json());
    const result = parsed.chart.result?.[0];
    if (!result) continue;
    const closes = result.indicators.quote[0]?.close ?? [];
    const adjusted = result.indicators.adjclose?.[0]?.adjclose ?? [];
    const sessions = (result.timestamp ?? []).map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: closes[index] ?? null, adjustedClose: adjusted[index] ?? null }));
    const match = matchHistoricalSession(sessions, requestedDate, { previousDays, nextDays, preferAdjusted: true });
    if (!match) throw new Error(`No Yahoo Finance session found within ${previousDays} days before or ${nextDays} days after ${requestedDate}.`);
    return {
      close: match.price, adjustedClose: match.session.adjustedClose, date: match.session.date, requestedDate,
      currency: result.meta.currency, ticker: result.meta.symbol, type: match.type, fallback: match.fallback,
      distanceDays: match.distanceDays, sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history`,
    };
  }
  throw new Error(`Yahoo Finance returned ${lastStatus || "no response"}.`);
}
