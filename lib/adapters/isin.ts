import { datasetCache } from "../runtime-env";

/**
 * An ISIN to the US ticker it trades under, where it has one.
 *
 * European brokers — Degiro, Trade Republic — identify a security by its ISIN
 * and never by its ticker. OpenFIGI, Bloomberg's open register of instrument
 * identifiers, maps one to every listing it has; a listing counts only on a US
 * exchange proper — NYSE, Nasdaq, NYSE American, NYSE Arca — and never on the
 * over-the-counter market, where a European company's ordinary shares trade in
 * dollars at a price nobody in Europe paid (ASML's NL0010273215 is ASMLF there;
 * its Nasdaq listing is a different ISIN). Yahoo's search is asked for what
 * OpenFIGI does not answer, on the same rule. Every answer — a null included —
 * is kept for thirty days: a listing does not move.
 */

export interface IsinListing { ticker: string; name: string; source: "OpenFIGI" | "Yahoo" }

/** OpenFIGI exchange codes for US exchanges proper. "US" is the composite, "UV" the OTC market. */
const EXCHANGES = new Set(["UN", "UW", "UQ", "UA", "UP", "UR", "UF"]);
const YAHOO_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"]);
export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const KEY = (isin: string) => `isin:v1:${isin}`;
const TTL = 30 * 86_400;

/** BRK/B and BRK-B are BRK.B here. */
const asTicker = (ticker: string) => ticker.toUpperCase().replace(/[/-]/g, ".");

interface FigiRow { ticker?: string; name?: string; exchCode?: string; securityType?: string }

/** The US listing among OpenFIGI's rows for one ISIN, or null. */
export function usListing(rows: FigiRow[]): { ticker: string; name: string } | null {
  const listed = rows.filter((row) => row.ticker && row.exchCode && EXCHANGES.has(row.exchCode));
  if (!listed.length) return null;
  // The ticker most of its US exchanges agree on.
  const counts = new Map<string, number>();
  for (const row of listed) counts.set(row.ticker!, (counts.get(row.ticker!) ?? 0) + 1);
  const ticker = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  return { ticker: asTicker(ticker), name: listed.find((row) => row.ticker === ticker)?.name ?? ticker };
}

async function fromOpenFigi(isins: string[]): Promise<Record<string, IsinListing | null>> {
  const out: Record<string, IsinListing | null> = {};
  // Ten jobs a request is the limit without a key.
  for (let start = 0; start < isins.length; start += 10) {
    const batch = isins.slice(start, start + 10);
    try {
      const response = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(process.env.OPENFIGI_KEY ? { "X-OPENFIGI-APIKEY": process.env.OPENFIGI_KEY } : {}) },
        body: JSON.stringify(batch.map((isin) => ({ idType: "ID_ISIN", idValue: isin }))),
      });
      if (!response.ok) continue;
      const jobs = await response.json() as Array<{ data?: FigiRow[] }>;
      batch.forEach((isin, index) => {
        const listing = usListing(jobs[index]?.data ?? []);
        out[isin] = listing ? { ...listing, source: "OpenFIGI" } : null;
      });
    } catch { /* Unanswered; Yahoo is asked next. */ }
  }
  return out;
}

async function fromYahoo(isin: string): Promise<IsinListing | null> {
  try {
    const response = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=6&newsCount=0`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return null;
    const body = await response.json() as { quotes?: Array<{ symbol?: string; exchange?: string; shortname?: string; longname?: string }> };
    const quote = (body.quotes ?? []).find((entry) => entry.symbol && entry.exchange && YAHOO_EXCHANGES.has(entry.exchange) && !entry.symbol.includes("."));
    return quote ? { ticker: asTicker(quote.symbol!), name: quote.longname ?? quote.shortname ?? quote.symbol!, source: "Yahoo" } : null;
  } catch {
    return null;
  }
}

export async function resolveIsins(requested: string[]): Promise<Record<string, IsinListing | null>> {
  const isins = [...new Set(requested.map((isin) => isin.trim().toUpperCase()).filter((isin) => ISIN.test(isin)))];
  const cache = datasetCache();
  const answers: Record<string, IsinListing | null> = {};
  const missing: string[] = [];
  await Promise.all(isins.map(async (isin) => {
    const stored = await cache?.get(KEY(isin), "text").catch(() => null);
    if (stored != null) answers[isin] = JSON.parse(stored) as IsinListing | null;
    else missing.push(isin);
  }));
  if (missing.length) {
    const figi = await fromOpenFigi(missing);
    for (const isin of missing) {
      const listing = figi[isin] ?? await fromYahoo(isin);
      answers[isin] = listing;
      // An unanswered request is not a "no listing": only a definite answer is kept.
      if (isin in figi || listing) await cache?.put(KEY(isin), JSON.stringify(listing), { expirationTtl: TTL }).catch(() => undefined);
    }
  }
  return answers;
}
