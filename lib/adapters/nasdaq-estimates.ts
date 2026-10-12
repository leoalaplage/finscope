import type { EpsEstimate, Estimates } from "../estimates";

/**
 * Analysts' estimates for one company, as Nasdaq publishes Zacks' consensus.
 *
 * Four small requests: the EPS forecasts (five quarters, the next fiscal
 * years), the momentum of the consensus (a week and a month ago), the price
 * target with the recommendations behind it, and the brokers covering it. Each
 * answers on its own; a part that fails is absent, never invented.
 */

const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
};

/** Nasdaq names share classes with a dot as the site does (BRK.B), lower-cased in its URLs. */
export const nasdaqSymbol = (ticker: string) => ticker.trim().toUpperCase().replace(/-/g, ".");

async function part<T>(symbol: string, path: string): Promise<T | null> {
  try {
    const response = await fetch(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/${path}`, { headers: HEADERS });
    if (!response.ok) return null;
    const body = await response.json() as { data?: T | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}

const number = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
};
const count = (value: unknown) => { const parsed = number(value); return parsed == null ? null : Math.round(parsed); };

interface ForecastRow { fiscalEnd?: string; consensusEPSForecast?: unknown; highEPSForecast?: unknown; lowEPSForecast?: unknown; noOfEstimates?: unknown; up?: unknown; down?: unknown }
interface Forecast { quarterlyForecast?: { rows?: ForecastRow[] | null }; yearlyForecast?: { rows?: ForecastRow[] | null } }
interface Momentum {
  changeInConsensus?: {
    monthData?: { qtrMean?: unknown; yrMean?: unknown }; weekData?: { qtrMean?: unknown; yrMean?: unknown }; currentData?: { qtrMean?: unknown; yrMean?: unknown };
    fiscalYearEndText?: string; fiscalQtrEndText?: string;
  };
}
interface Target {
  consensusOverview?: { lowPriceTarget?: unknown; highPriceTarget?: unknown; priceTarget?: unknown; buy?: unknown; hold?: unknown; sell?: unknown };
  historicalConsensus?: Array<{ z?: { buy?: unknown; hold?: unknown; sell?: unknown; date?: string } }>;
}
interface Ratings { meanRatingType?: string; brokerNames?: string[] }

const rows = (list: ForecastRow[] | null | undefined): EpsEstimate[] => (list ?? []).flatMap((row) => {
  if (!row.fiscalEnd) return [];
  return [{
    fiscalEnd: row.fiscalEnd.trim(), consensus: number(row.consensusEPSForecast), high: number(row.highEPSForecast), low: number(row.lowEPSForecast),
    analysts: count(row.noOfEstimates), up: count(row.up), down: count(row.down),
  }];
});

/** "10/01/2025" → "2025-10-01". */
const isoDate = (text: string | undefined) => {
  const match = text?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
};
const after = (text: string | undefined, prefix: RegExp) => text?.replace(prefix, "").trim() || null;

export function parseEstimates(ticker: string, forecast: Forecast | null, momentum: Momentum | null, target: Target | null, ratings: Ratings | null, asOf: string): Estimates {
  const change = momentum?.changeInConsensus;
  const overview = target?.consensusOverview;
  const buy = count(overview?.buy); const hold = count(overview?.hold); const sell = count(overview?.sell);
  return {
    ticker: ticker.toUpperCase(),
    asOf,
    quarterly: rows(forecast?.quarterlyForecast?.rows),
    yearly: rows(forecast?.yearlyForecast?.rows),
    momentum: change ? {
      quarter: { label: after(change.fiscalQtrEndText, /^Fiscal Quarter End/i), now: number(change.currentData?.qtrMean), weekAgo: number(change.weekData?.qtrMean), monthAgo: number(change.monthData?.qtrMean) },
      year: { label: after(change.fiscalYearEndText, /^Fiscal Year End/i), now: number(change.currentData?.yrMean), weekAgo: number(change.weekData?.yrMean), monthAgo: number(change.monthData?.yrMean) },
    } : null,
    target: overview && (number(overview.priceTarget) != null || number(overview.lowPriceTarget) != null)
      ? { low: number(overview.lowPriceTarget), mean: number(overview.priceTarget), high: number(overview.highPriceTarget) }
      : null,
    ratings: buy != null || hold != null || sell != null
      ? { buy: buy ?? 0, hold: hold ?? 0, sell: sell ?? 0, label: ratings?.meanRatingType ?? null, brokers: ratings?.brokerNames?.length ?? null }
      : null,
    ratingHistory: (target?.historicalConsensus ?? []).flatMap((entry) => {
      const date = isoDate(entry.z?.date);
      return date ? [{ date, buy: count(entry.z?.buy) ?? 0, hold: count(entry.z?.hold) ?? 0, sell: count(entry.z?.sell) ?? 0 }] : [];
    }),
    source: "Zacks Investment Research, via Nasdaq",
  };
}

export async function fetchEstimates(ticker: string): Promise<Estimates> {
  const symbol = nasdaqSymbol(ticker);
  const [forecast, momentum, target, ratings] = await Promise.all([
    part<Forecast>(symbol, "earnings-forecast"),
    part<Momentum>(symbol, "estimate-momentum"),
    part<Target>(symbol, "targetprice"),
    part<Ratings>(symbol, "ratings"),
  ]);
  return parseEstimates(ticker, forecast, momentum, target, ratings, new Date().toISOString());
}
