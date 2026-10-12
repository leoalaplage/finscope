import type { EpsEstimate, EpsSurprise, Estimates } from "../estimates";

/**
 * Analysts' estimates for one company, as Nasdaq publishes Zacks' consensus.
 *
 * Five small requests: the EPS forecasts (five quarters, the next fiscal
 * years), the momentum of the consensus (a week and a month ago), the price
 * target with the recommendations behind it, the brokers covering it, and
 * the last four quarters' EPS against the consensus before them. Each
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

/**
 * One part, asked twice if the first answer is a refusal or empty: Nasdaq
 * turns away a share of requests from shared cloud addresses and answers the
 * same one a moment later.
 */
async function part<T>(symbol: string, path: string, waits: number[] = [700], base = "analyst"): Promise<T | null> {
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      const response = await fetch(`https://api.nasdaq.com/api/${base}/${encodeURIComponent(symbol)}/${path}`, { headers: HEADERS });
      if (response.ok) {
        const body = await response.json() as { data?: T | null };
        if (body.data) return body.data;
      }
    } catch { /* Asked again below. */ }
    if (attempt < waits.length) await new Promise((resolve) => setTimeout(resolve, waits[attempt] + Math.random() * 300));
  }
  return null;
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
interface Surprises { earningsSurpriseTable?: { rows?: Array<{ fiscalQtrEnd?: string; dateReported?: string; eps?: unknown; consensusForecast?: unknown; percentageSurprise?: unknown }> | null } }

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

/** "8/12/2026" → "2026-08-12". */
const usDate = (text: string | undefined) => {
  const match = text?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : null;
};

export function parseSurprises(surprises: Surprises | null): EpsSurprise[] {
  return (surprises?.earningsSurpriseTable?.rows ?? []).flatMap((row) => (row.fiscalQtrEnd ? [{
    fiscalEnd: row.fiscalQtrEnd.trim(), reported: usDate(row.dateReported),
    eps: number(row.eps), consensus: number(row.consensusForecast), surprise: number(row.percentageSurprise),
  }] : []));
}

export function parseEstimates(ticker: string, forecast: Forecast | null, momentum: Momentum | null, target: Target | null, ratings: Ratings | null, asOf: string, surprises: Surprises | null = null): Estimates {
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
    surprises: parseSurprises(surprises),
    source: "Zacks Investment Research, via Nasdaq",
  };
}

export async function fetchEstimates(ticker: string): Promise<Estimates> {
  const symbol = nasdaqSymbol(ticker);
  const [forecast, momentum, target, ratings, surprises] = await Promise.all([
    part<Forecast>(symbol, "earnings-forecast"),
    part<Momentum>(symbol, "estimate-momentum"),
    part<Target>(symbol, "targetprice"),
    part<Ratings>(symbol, "ratings"),
    part<Surprises>(symbol, "earnings-surprise", [700], "company"),
  ]);
  return parseEstimates(ticker, forecast, momentum, target, ratings, new Date().toISOString(), surprises);
}
