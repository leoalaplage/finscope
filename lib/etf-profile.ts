import {
  exposureBy, fetchJson, fetchText, fundIdentity, latestSeriesFiling, nameKey, parseNport, parseProspectus,
  type EtfHolding, type EtfProfile, type NotReported,
} from "./adapters/etf";
import { resolveIsins } from "./adapters/isin";
import { sameListing, searchSecCompanies } from "./adapters/sec";
import { cachedJson } from "./market-cache";
import { readServedUniverse } from "./universe-build";
import { stated } from "./sector";

/**
 * A fund's page, assembled from its own filings (lib/adapters/etf.ts) and kept
 * for a day: its holdings change monthly and are published two months late,
 * its prospectus yearly.
 *
 * A holding is matched to a company this site already reads — by its listed
 * ticker where the report gives one, by name otherwise — and takes that
 * company's sector; the rest are named by OpenFIGI from their ISIN where they
 * weigh most. The sector chart says how much of the fund it could classify.
 */

export const ETF_SHAPE = "etf2";
const REGISTER_KEY = "etf-register:v1";
const DAY = 86_400;

type Register = { fields: string[]; data: Array<[number, string, string, string]> };

async function register(): Promise<Register> {
  const { body } = await cachedJson<Register>(REGISTER_KEY, DAY, async () => (await fetchJson<Register>("https://www.sec.gov/files/company_tickers_mf.json")) ?? { fields: [], data: [] },
    (value) => (value.data.length ? "full" : "empty"));
  return JSON.parse(body) as Register;
}

/**
 * Whether a ticker is a fund rather than a company, without building anything:
 * a share class in the SEC's fund register, or a filer the SEC names as an
 * exchange-traded fund or note (SPY, DIA and GLD are trusts, outside the
 * register, but "ETF" is in their names).
 */
export async function isFund(ticker: string): Promise<boolean> {
  if (await fundIdentity(ticker, register)) return true;
  const listed = (await searchSecCompanies(ticker).catch(() => [])).find((entry) => sameListing(entry.ticker, ticker));
  return listed != null && /\b(ETF|ETN|ETP)\b/i.test(listed.name);
}

async function classify(holdings: EtfHolding[]): Promise<number> {
  const universe = await readServedUniverse().catch(() => null);
  const byName = new Map<string, { ticker: string; sector: string | null }>();
  const byTicker = new Map<string, { ticker: string; sector: string | null }>();
  for (const row of universe?.rows ?? []) {
    const sector = typeof row.qs?.Sector === "string" ? stated(row.qs.Sector) : null;
    byName.set(nameKey(row.name), { ticker: row.ticker, sector });
    byTicker.set(row.ticker, { ticker: row.ticker, sector });
  }
  let classified = 0;
  for (const holding of holdings) {
    const match = (holding.ticker ? byTicker.get(holding.ticker.replace(/[/-]/g, ".")) : null) ?? byName.get(nameKey(holding.name));
    if (match) {
      holding.ticker ??= match.ticker;
      holding.sector = match.sector;
    }
    if (holding.sector) classified += Math.max(0, holding.weight);
  }
  // The heaviest holdings still unnamed, by ISIN: thirty at most, each kept a month.
  const unnamed = holdings.filter((holding) => !holding.ticker && holding.isin).slice(0, 30);
  if (unnamed.length) {
    const listings = await resolveIsins(unnamed.map((holding) => holding.isin!)).catch(() => ({} as Record<string, null>));
    for (const holding of unnamed) {
      const listing = listings[holding.isin!.toUpperCase()];
      if (listing) holding.ticker = listing.ticker;
    }
  }
  return classified;
}

export async function buildEtfProfile(ticker: string): Promise<EtfProfile | NotReported> {
  const identity = await fundIdentity(ticker, register);
  if (!identity) {
    return { ticker: ticker.toUpperCase(), kind: "unreported", reason: "The SEC registers no fund share class under this ticker. A unit investment trust (SPY, DIA) or a commodity trust (GLD) files no monthly portfolio report, so its holdings cannot be read here." };
  }
  const [nport, prospectus] = await Promise.all([
    latestSeriesFiling(identity.seriesId, "NPORT-P"),
    latestSeriesFiling(identity.seriesId, "485BPOS"),
  ]);
  let portfolio = null;
  if (nport) {
    const xml = await fetchText(`${nport.folder}/primary_doc.xml`);
    if (xml) portfolio = parseNport(xml, { filed: nport.filed, url: `${nport.folder}/` });
  }
  let fees = null;
  if (prospectus) {
    const listing = await fetchJson<{ directory: { item: Array<{ name: string }> } }>(`${prospectus.folder}/index.json`);
    const instance = listing?.directory.item.map((item) => item.name).find((name) => name.endsWith("_htm.xml"));
    const xml = instance ? await fetchText(`${prospectus.folder}/${instance}`) : null;
    if (xml) fees = parseProspectus(xml, identity.seriesId, identity.classId, { filed: prospectus.filed, url: `${prospectus.folder}/` });
  }
  const holdings = portfolio?.holdings ?? [];
  const classified = holdings.length ? await classify(holdings) : 0;
  const positive = holdings.filter((holding) => holding.weight > 0);
  return {
    ticker: identity.ticker,
    kind: "fund",
    identity,
    name: portfolio?.name ?? identity.ticker,
    // Two hundred positions on the page: the rest are in the exposures, and in the report linked.
    portfolio: portfolio ? { ...portfolio, holdings: holdings.slice(0, 200) } : null,
    prospectus: fees,
    exposure: {
      sector: exposureBy(positive, (holding) => holding.sector ?? (holding.assetClass === "Equity" ? null : holding.assetClass)),
      country: exposureBy(positive, (holding) => holding.country && holding.country !== "N/A" ? holding.country : null),
      assetClass: exposureBy(positive, (holding) => holding.assetClass, 8),
      currency: exposureBy(positive, (holding) => holding.currency, 8),
      issuerType: exposureBy(positive, (holding) => holding.issuerType, 8),
    },
    topTenWeight: positive.length ? positive.slice(0, 10).reduce((sum, holding) => sum + holding.weight, 0) : null,
    sectorCoverage: classified,
    builtAt: new Date().toISOString(),
  };
}

export async function getEtfProfile(ticker: string): Promise<string> {
  const { body } = await cachedJson<EtfProfile | NotReported>(`etf:${ETF_SHAPE}:${ticker.toUpperCase()}`, DAY, () => buildEtfProfile(ticker),
    (value) => (value.kind === "fund" && value.portfolio ? "full" : value.kind === "unreported" ? "full" : "partial"));
  return body;
}

/**
 * A fund share class as the search box lists a company, where the query is its
 * exact ticker: the SEC's company register, which the search reads, does not
 * carry most funds (VOO, XLK, QQQ), so typing one found nothing.
 */
export async function fundSearchEntry(query: string) {
  const identity = await fundIdentity(query.trim(), register).catch(() => null);
  if (!identity) return null;
  return {
    name: `Exchange-traded fund · ${identity.ticker}`, ticker: identity.ticker, cik: identity.cik, regulatoryId: `CIK ${identity.cik}`,
    exchange: "US listing", currency: "USD", yahooTicker: identity.ticker, sector: "Fund", description: "An exchange-traded fund, read from its N-PORT and prospectus filings.",
    resolutionStatus: "partial" as const, resolutionNote: "A fund share class in the SEC's fund register.", businessType: "operating" as const,
  };
}
