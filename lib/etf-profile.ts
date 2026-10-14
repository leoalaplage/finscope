import {
  exposureBy, fetchJson, fetchText, fundIdentity, latestSeriesFiling, nameKey, parseCommodityTrust, parseNport, parseProspectus,
  type CommodityTrust, type EtfHolding, type EtfProfile, type NotReported,
} from "./adapters/etf";
import { fetchSsgaHoldings, fetchSsgaNavHistory, isSsgaFund, issuerAnswers, type IssuerHolding, type NavDay } from "./adapters/ssga";
import { resolveIsins } from "./adapters/isin";
import { sameListing, searchSecCompanies } from "./adapters/sec";
import { cachedJson, marketKey } from "./market-cache";
import { companyByTicker } from "./company-registry";
import { universeMember } from "./universe";
import { datasetCache } from "./runtime-env";
import { readServedUniverse } from "./universe-build";
import { stated } from "./sector";

/**
 * A fund's page, assembled from its own filings (lib/adapters/etf.ts) — and,
 * for a fund whose issuer publishes daily files read here (lib/adapters/ssga.ts),
 * from those — and kept for a day. The SEC's monthly holdings are published
 * two months late; an issuer's are yesterday's, and its NAV history carries
 * the shares outstanding every day, which is what the fund's flows are made of.
 *
 * A holding is matched to a company this site already reads — by its listed
 * ticker where the report gives one, by name otherwise — and takes that
 * company's sector; the rest are named by OpenFIGI from their ISIN where they
 * weigh most. The sector chart says how much of the fund it could classify.
 */

export const ETF_SHAPE = "etf11";
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
  // Named as an exchange-traded product, a SPDR or iShares product, or a trust of a metal or a coin — never
  // "trust" alone, which is also what a real-estate investment trust is called.
  return listed != null && /\b(ETF|ETN|ETP|SPDR|ISHARES)\b|\b(GOLD|SILVER|PLATINUM|PALLADIUM|BITCOIN|ETHER(EUM)?)\b[\w\s]*\bTRUST\b/i.test(listed.name);
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

/** The SEC's company record of a trust outside the fund register: its identifier and the name the SEC gives it. */
async function trustRecord(ticker: string): Promise<{ cik: string; name: string } | null> {
  // A register that did not answer throws, and is not read as "no such ticker": that verdict would be kept a day.
  const listed = (await searchSecCompanies(ticker)).find((entry) => sameListing(entry.ticker, ticker));
  return listed?.cik ? { cik: listed.cik, name: listed.name } : null;
}

/**
 * An issuer's file, read now where its site answers, or its last good copy.
 *
 * State Street's site turns some requests from a data centre away (403) and
 * serves the same file a minute later; the fund's holdings should not vanish
 * from the page for a day because of it. Every good read is kept a week, and a
 * refused one is answered from it — the page states the file's own date.
 */
async function lastGood<T>(key: string, read: () => Promise<T | null>, usable: (value: T) => boolean): Promise<T | null> {
  const cache = datasetCache();
  const fresh = await read().catch(() => null);
  if (fresh != null && usable(fresh)) {
    await cache?.put(key, JSON.stringify(fresh), { expirationTtl: 7 * DAY }).catch(() => undefined);
    return fresh;
  }
  const kept = await cache?.get(key, "text").catch(() => null);
  return kept ? JSON.parse(kept) as T : null;
}

/** Issuer rows as holdings, completed from the SEC's report where the same security is in it. */
function fromIssuer(rows: IssuerHolding[], netAssets: number | null, reported: EtfHolding[]): EtfHolding[] {
  const byCusip = new Map(reported.filter((holding) => holding.cusip).map((holding) => [holding.cusip!, holding]));
  return rows.map((row) => {
    const known = row.cusip ? byCusip.get(row.cusip) : undefined;
    return {
      name: row.name, ticker: row.ticker, isin: known?.isin ?? null, cusip: row.cusip,
      value: netAssets != null ? row.weight * netAssets : known?.value ?? 0,
      weight: row.weight,
      // What the issuer's file does not state is taken from the fund's own SEC report, or left unclassified.
      assetClass: known?.assetClass ?? (row.ticker ? "Listed security" : "Other"),
      issuerType: known?.issuerType ?? "Other",
      country: known?.country ?? null,
      currency: row.currency ?? known?.currency ?? null,
      sector: null,
    };
  });
}

export async function buildEtfProfile(ticker: string): Promise<EtfProfile | NotReported> {
  const identity = await fundIdentity(ticker, register);
  const trust = identity ? null : await trustRecord(ticker);
  if (!identity && !trust) {
    return { ticker: ticker.toUpperCase(), kind: "unreported", reason: "Neither the SEC's fund register nor its company register knows this ticker." };
  }
  const [nport, prospectus] = identity ? await Promise.all([
    latestSeriesFiling(identity.seriesId, "NPORT-P"),
    latestSeriesFiling(identity.seriesId, "485BPOS"),
  ]) : [null, null];
  let portfolio = null;
  if (nport) {
    const xml = await fetchText(`${nport.folder}/primary_doc.xml`);
    if (xml) portfolio = parseNport(xml, { filed: nport.filed, url: `${nport.folder}/` });
  }
  let fees = null;
  if (prospectus && identity) {
    const listing = await fetchJson<{ directory: { item: Array<{ name: string }> } }>(`${prospectus.folder}/index.json`);
    const instance = listing?.directory.item.map((item) => item.name).find((name) => name.endsWith("_htm.xml"));
    const xml = instance ? await fetchText(`${prospectus.folder}/${instance}`) : null;
    if (xml) fees = parseProspectus(xml, identity.seriesId, identity.classId, { filed: prospectus.filed, url: `${prospectus.folder}/` });
  }

  // A trust holding a commodity states its whole portfolio in its 10-K and 10-Q.
  let commodity: CommodityTrust | null = null;
  if (trust) {
    const facts = await fetchJson<{ facts: Parameters<typeof parseCommodityTrust>[0] }>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${trust.cik.padStart(10, "0")}.json`).catch(() => null);
    if (facts) commodity = parseCommodityTrust(facts.facts, trust.name);
  }

  // The issuer's daily files, for a fund whose issuer publishes them in a form read here.
  const name = portfolio?.name || trust?.name || ticker;
  // One after the other: two at once from one address is what the issuer's site turns away.
  const ssga = isSsgaFund(name) && !commodity;
  const daily = ssga ? await lastGood(`issuer-holdings:v1:${ticker.toUpperCase()}`, () => fetchSsgaHoldings(ticker), (value) => value.holdings.length > 0) : null;
  const navHistory: NavDay[] = ssga ? await lastGood(`issuer-navhist:v1:${ticker.toUpperCase()}`, async () => (await fetchSsgaNavHistory(ticker)).slice(-1300), (value) => value.length > 0) ?? [] : [];
  // Five years of days are enough for every window the page draws.
  const history = navHistory.slice(-1300);
  const latestAssets = history.at(-1)?.netAssets ?? portfolio?.netAssets ?? null;

  const reported = portfolio?.holdings ?? [];
  const useIssuer = daily != null && (!portfolio || daily.asOf > portfolio.asOf);
  const holdings = useIssuer ? fromIssuer(daily!.holdings, latestAssets, reported) : reported;
  const classified = holdings.length ? await classify(holdings) : 0;
  const positive = holdings.filter((holding) => holding.weight > 0);
  if (!holdings.length && !commodity && !fees && !history.length) {
    return { ticker: ticker.toUpperCase(), kind: "unreported", reason: "This fund files no monthly portfolio report and no XBRL prospectus with the SEC, and its issuer publishes no file read here." };
  }
  return {
    ticker: ticker.toUpperCase(),
    kind: "fund",
    identity,
    name: daily && !portfolio ? (trust?.name ?? name) : name,
    // Two hundred positions on the page: the rest are in the exposures, and in the report linked.
    portfolio: portfolio || useIssuer ? {
      filed: portfolio?.filed ?? daily!.asOf,
      url: portfolio?.url ?? daily!.source,
      asOf: useIssuer ? daily!.asOf : portfolio!.asOf,
      name,
      netAssets: latestAssets,
      totalAssets: portfolio?.totalAssets ?? null,
      holdingsCount: holdings.length,
      holdings: holdings.slice(0, 200),
      monthlyReturns: portfolio?.monthlyReturns ?? [],
    } : null,
    holdingsSource: useIssuer ? { kind: "issuer", asOf: daily!.asOf, url: daily!.source }
      : portfolio ? { kind: "N-PORT", asOf: portfolio.asOf, url: portfolio.url } : null,
    history,
    commodity,
    issuerNotes: ssga ? [...issuerAnswers].filter(([url]) => url.includes(`-${ticker.toLowerCase()}.xlsx`)).map(([url, answer]) => `${url.split("/").pop()}: ${answer}`) : undefined,
    prospectus: fees,
    exposure: {
      // Every sector, not the largest few: a portfolio holding the fund spreads it over all of them.
      sector: exposureBy(positive, (holding) => holding.sector ?? (holding.assetClass === "Equity" || holding.assetClass === "Listed security" ? null : holding.assetClass), 40),
      country: exposureBy(positive, (holding) => holding.country && holding.country !== "N/A" ? holding.country : null),
      assetClass: exposureBy(positive, (holding) => holding.assetClass, 8),
      currency: exposureBy(positive, (holding) => holding.currency, 8),
      issuerType: useIssuer ? [] : exposureBy(positive, (holding) => holding.issuerType, 8),
    },
    topTenWeight: positive.length ? positive.slice(0, 10).reduce((sum, holding) => sum + holding.weight, 0) : null,
    sectorCoverage: classified,
    builtAt: new Date().toISOString(),
  };
}

export async function getEtfProfile(ticker: string): Promise<string> {
  const { body } = await cachedJson<EtfProfile | NotReported>(`etf:${ETF_SHAPE}:${ticker.toUpperCase()}`, DAY, () => buildEtfProfile(ticker),
    // An issuer whose daily file did not answer is asked again in a minute rather than missed for a day.
    // A ticker no register knows is settled for the day; a registered fund with nothing read is asked again in a minute.
    (value) => (value.kind === "unreported" ? (value.reason.startsWith("Neither") ? "full" : "partial")
      : value.portfolio && !(isSsgaFund(value.name) && !value.commodity && !value.history.length) ? "full" : "partial"));
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

/**
 * What a watchlist or a portfolio shows for a fund: its name and the few
 * figures a card has room for, read from the profile already built for the
 * fund's page — never a build of its own, which reads several filings and an
 * issuer's files and has no place in a list's answer. A fund whose page was
 * never opened is listed by its ticker, its figures blank, and the profile is
 * built in the background so the next answer has them.
 */
export interface FundCard {
  ticker: string;
  kind: "fund";
  name: string;
  expenseRatio: number | null;
  netAssets: number | null;
  holdingsCount: number | null;
  topTenWeight: number | null;
  /** The largest sector, where the holdings could be classified. */
  sector: string | null;
  /** Each sector's share of the fund, where the holdings could be classified; the rest is unclassified. */
  sectors: Array<{ label: string; weight: number }>;
  indexName: string | null;
  /** Calendar-year returns at NAV, newest last. */
  calendar: Array<{ year: number; fund: number }>;
}

export async function fundCard(ticker: string, background?: (work: Promise<unknown>) => void): Promise<FundCard | null> {
  const symbol = ticker.toUpperCase();
  if (companyByTicker(symbol) || universeMember(symbol) || !(await isFund(symbol).catch(() => false))) return null;
  let profile: EtfProfile | null = null;
  try {
    const stored = await datasetCache()?.get(marketKey(`etf:${ETF_SHAPE}:${symbol}`), "text");
    const parsed = stored ? JSON.parse(stored) as EtfProfile | NotReported : null;
    if (parsed?.kind === "fund") profile = parsed;
  } catch {
    // Listed by its ticker alone.
  }
  if (!profile) background?.(getEtfProfile(symbol).catch(() => null));
  const latestNetAssets = profile?.history.at(-1)?.netAssets ?? profile?.portfolio?.netAssets ?? null;
  return {
    ticker: symbol, kind: "fund",
    name: profile?.name || symbol,
    expenseRatio: profile?.prospectus?.expenseRatio ?? null,
    netAssets: latestNetAssets,
    holdingsCount: profile?.portfolio?.holdingsCount ?? null,
    topTenWeight: profile?.topTenWeight ?? null,
    sector: profile?.exposure.sector[0]?.label ?? (profile?.commodity ? "Commodity" : null),
    sectors: profile?.exposure.sector.length ? profile.exposure.sector : profile?.commodity ? [{ label: "Commodity", weight: 1 }] : [],
    indexName: profile?.prospectus?.returns.indexName ?? null,
    calendar: profile?.prospectus?.returns.calendar.slice(-5) ?? [],
  };
}

/**
 * The tickers of a list that are companies, its funds left out: what the
 * warm on a watchlist read should build. A fund is never built as a company,
 * so left in it would take the warm's few places on every read and the
 * company the reader added beside it would wait for ever.
 */
export async function companiesOnly(tickers: string[]): Promise<string[]> {
  const funds = await Promise.all(tickers.map((ticker) => companyByTicker(ticker) || universeMember(ticker)
    ? false : isFund(ticker).catch(() => false)));
  return tickers.filter((_, index) => !funds[index]);
}
