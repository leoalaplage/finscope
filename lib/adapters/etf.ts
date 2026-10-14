/**
 * An exchange-traded fund, read from what it files with the SEC.
 *
 * A company is read from its financial statements; a fund has none worth the
 * name. What it does file says more: every month, on Form N-PORT, every
 * position it holds — name, identifiers, value, weight, asset class, country,
 * currency — with its net assets and its monthly returns; and every year, in
 * its prospectus, its fees, its objective, its turnover and its returns year by
 * year against its index, all in XBRL. Both are public and free, and both are
 * the fund's own statement, which is the standard every figure on this site is
 * held to.
 *
 * Not every listed fund files them. A unit investment trust (SPY, DIA) files no
 * N-PORT and no XBRL prospectus, and a commodity trust (GLD) files a company's
 * 10-K instead; those are named as what they are rather than shown half-empty.
 */

export interface FundIdentity { ticker: string; cik: string; seriesId: string; classId: string }

export interface EtfHolding {
  name: string;
  /** The listing a holding trades under in the US, where it could be named. */
  ticker: string | null;
  isin: string | null;
  cusip: string | null;
  /** US dollars, as the report values it. */
  value: number;
  /** Of net assets, as a fraction. */
  weight: number;
  assetClass: string;
  issuerType: string;
  country: string | null;
  currency: string | null;
  sector: string | null;
}

export interface Exposure { label: string; weight: number }

export interface EtfReturns {
  /** Calendar-year total returns at net asset value, oldest first. */
  calendar: Array<{ year: number; fund: number }>;
  /** Average annual returns to the prospectus's year end: the fund at NAV, and its index. */
  average: Array<{ years: number; fund: number | null; index: number | null }>;
  indexName: string | null;
  best: { value: number; date: string | null } | null;
  worst: { value: number; date: string | null } | null;
}

export interface EtfProspectus {
  filed: string;
  url: string;
  expenseRatio: number | null;
  managementFee: number | null;
  otherExpenses: number | null;
  turnover: number | null;
  objective: string | null;
  returns: EtfReturns;
}

export interface EtfPortfolio {
  filed: string;
  url: string;
  /** The date the positions were held at. */
  asOf: string;
  name: string;
  netAssets: number | null;
  totalAssets: number | null;
  holdingsCount: number;
  holdings: EtfHolding[];
  /** Monthly total returns of the share class reported, last three months, oldest first. */
  monthlyReturns: Array<{ month: string; value: number }>;
}

export interface EtfProfile {
  ticker: string;
  kind: "fund";
  identity: FundIdentity;
  name: string;
  portfolio: EtfPortfolio | null;
  prospectus: EtfProspectus | null;
  exposure: { sector: Exposure[]; country: Exposure[]; assetClass: Exposure[]; currency: Exposure[]; issuerType: Exposure[] };
  topTenWeight: number | null;
  /** How much of the fund the sector exposure could be read for. */
  sectorCoverage: number;
  builtAt: string;
}

/** What a ticker that is not a filing company is, when it is not a fund that reports holdings either. */
export interface NotReported { ticker: string; kind: "unreported"; reason: string }

const UA = () => ({ "User-Agent": process.env.SEC_USER_AGENT || "FinScope research application contact@example.com" });

/* --- Parsing, pure ------------------------------------------------------- */

const text = (xml: string, tag: string) => xml.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*</(?:\\w+:)?${tag}>`))?.[1] ?? null;
const number = (value: string | null | undefined) => {
  if (value == null || value.trim() === "" || value === "N/A") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ASSET_CLASSES: Record<string, string> = {
  EC: "Equity", EP: "Preferred equity", DBT: "Debt", ABS: "Asset-backed", "ABS-MBS": "Mortgage-backed", "ABS-CBDO": "Collateralised debt",
  "ABS-O": "Asset-backed", "ABS-APCP": "Asset-backed CP", LON: "Loans", STIV: "Short-term vehicles", RE: "Real estate", COMM: "Commodity",
  DCO: "Commodity derivative", DCR: "Credit derivative", DE: "Equity derivative", DFE: "FX derivative", DIR: "Rate derivative", DO: "Other derivative",
  SN: "Structured note", OTHER: "Other",
};
const ISSUER_TYPES: Record<string, string> = {
  CORP: "Corporate", UST: "US Treasury", USGA: "US agency", USGSE: "US GSE", MUN: "Municipal", NUSS: "Non-US sovereign", PF: "Private fund", RF: "Registered fund", OTHER: "Other",
};

/** One N-PORT report: the positions, the totals and the three months it covers. */
export function parseNport(xml: string, filing: { filed: string; url: string }): EtfPortfolio {
  const netAssets = number(text(xml, "netAssets"));
  const holdings: EtfHolding[] = [];
  for (const match of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/g)) {
    const body = match[1];
    const value = number(text(body, "valUSD"));
    const pct = number(text(body, "pctVal"));
    if (value == null) continue;
    const isin = body.match(/<isin\s+value="([^"]+)"/)?.[1] ?? null;
    const ticker = body.match(/<ticker\s+value="([^"]+)"/)?.[1] ?? null;
    const cusip = text(body, "cusip");
    const asset = text(body, "assetCat") ?? body.match(/<assetConditional\s+desc="([^"]+)"/)?.[1] ?? "OTHER";
    const issuer = text(body, "issuerCat") ?? body.match(/<issuerConditional\s+desc="([^"]+)"/)?.[1] ?? "OTHER";
    holdings.push({
      name: text(body, "name") ?? text(body, "title") ?? "Unnamed",
      ticker: ticker && ticker !== "N/A" ? ticker.toUpperCase() : null,
      isin: isin && isin !== "N/A" ? isin : null,
      cusip: cusip && cusip !== "N/A" && cusip !== "000000000" ? cusip : null,
      value,
      weight: pct != null ? pct / 100 : netAssets ? value / netAssets : 0,
      assetClass: ASSET_CLASSES[asset] ?? asset,
      issuerType: ISSUER_TYPES[issuer] ?? issuer,
      country: text(body, "invCountry"),
      currency: text(body, "curCd"),
      sector: null,
    });
  }
  holdings.sort((left, right) => right.weight - left.weight);
  const period = text(xml, "repPdDate") ?? "";
  // The three months the report covers end at its period date: rtn1 is two months before it.
  const months = [2, 1, 0].map((back) => {
    const date = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - back);
    return date.toISOString().slice(0, 7);
  });
  const returns = xml.match(/<monthlyTotReturn\b[^>]*rtn1="([^"]*)"[^>]*rtn2="([^"]*)"[^>]*rtn3="([^"]*)"/);
  const monthlyReturns = returns ? [returns[1], returns[2], returns[3]].flatMap((value, index) => {
    const parsed = number(value);
    return parsed == null ? [] : [{ month: months[index], value: parsed / 100 }];
  }) : [];
  return {
    filed: filing.filed, url: filing.url, asOf: period,
    name: text(xml, "seriesName") ?? "",
    netAssets, totalAssets: number(text(xml, "totAssets")),
    holdingsCount: holdings.length, holdings, monthlyReturns,
  };
}

const prettyMember = (member: string) => member.replace(/^[\w-]+:/, "").replace(/Member$/, "")
  // Some filers name the member as a sentence: "index_Nasdaq-100_Index_reflects_no_deduction…" — keep the name, up to "Index".
  .replace(/^index_/i, "").replace(/(Index)_.*$/i, "$1").replace(/_/g, " ")
  .replace(/(\d)([A-Z])/g, "$1 $2").replace(/StandardandPoors|StandardAndPoors|SAndP/g, "S&P ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  .replace(/\bCapex US\b/g, "Cap ex US").replace(/\s+/g, " ").trim();
/** A text block's words: its markup removed and its entities decoded, twice escaped as XBRL text blocks often are. */
function stripHtml(html: string): string {
  let text = html;
  for (let pass = 0; pass < 2; pass++) text = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  return text.replace(/<[^>]+>/g, " ").replace(/&#x2019;|&#8217;/g, "'").replace(/&#x201[cCdD];|&#822[01];/g, "\"")
    .replace(/&#x201[34];|&#821[12];/g, "—").replace(/&#(x[0-9a-fA-F]+|\d+);/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The prospectus's risk/return summary for one share class: fees, objective,
 * turnover, returns by calendar year and on average against its index.
 */
export function parseProspectus(xml: string, seriesId: string, classId: string, filing: { filed: string; url: string }): EtfProspectus | null {
  const contexts = new Map<string, { dims: Map<string, string>; start: string | null; end: string | null }>();
  for (const match of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = match[2];
    const dims = new Map([...body.matchAll(/dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((each) => [each[1].replace(/^[\w-]+:/, ""), each[2].replace(/^[\w-]+:/, "")]));
    contexts.set(match[1], {
      dims,
      start: body.match(/<(?:xbrli:)?startDate>\s*([^<\s]+)/)?.[1] ?? null,
      end: body.match(/<(?:xbrli:)?endDate>\s*([^<\s]+)/)?.[1] ?? body.match(/<(?:xbrli:)?instant>\s*([^<\s]+)/)?.[1] ?? null,
    });
  }
  const facts = (concept: string) => [...xml.matchAll(new RegExp(`<(?:oef|rr):${concept}\\b([^>]*)>([\\s\\S]*?)</(?:oef|rr):${concept}>`, "g"))]
    .flatMap((match) => {
      const context = contexts.get(match[1].match(/contextRef="([^"]+)"/)?.[1] ?? "");
      return context ? [{ ...context, value: match[2] }] : [];
    });
  const ofClass = (concept: string) => facts(concept).filter((fact) => fact.dims.get("ClassAxis") === `${classId}Member`);
  const ofSeries = (concept: string) => facts(concept).filter((fact) => fact.dims.get("LegalEntityAxis") === `${seriesId}Member`);
  const one = (list: Array<{ value: string }>) => number(list[0]?.value);
  // A prospectus can carry several share classes; the ETF's own document comes first where one is tagged.
  const etfFirst = <T extends { dims: Map<string, string> }>(list: T[]) =>
    [...list].sort((left, right) => Number(/ETF/i.test(right.dims.get("DocumentInformationDocumentAxis") ?? "")) - Number(/ETF/i.test(left.dims.get("DocumentInformationDocumentAxis") ?? "")));

  const expenseRatio = one(ofClass("ExpensesOverAssets"));
  if (expenseRatio == null && !ofClass("AnnlRtrPct").length) return null;
  const objective = etfFirst(ofSeries("ObjectivePrimaryTextBlock"))[0]?.value ?? null;
  const turnover = one(etfFirst(ofSeries("PortfolioTurnoverRate")));

  const calendar = ofClass("AnnlRtrPct").flatMap((fact) => {
    const value = number(fact.value);
    return value == null || !fact.end ? [] : [{ year: Number(fact.end.slice(0, 4)), fund: value }];
  }).sort((left, right) => left.year - right.year)
    .filter((entry, index, list) => index === 0 || list[index - 1].year !== entry.year);

  const span = (fact: { start: string | null; end: string | null }) => (fact.start && fact.end ? Math.round((Date.parse(fact.end) - Date.parse(fact.start)) / (365.25 * 86_400_000)) : null);
  const fundAverage = new Map<number, number>();
  for (const fact of ofClass("AvgAnnlRtrPct")) {
    const measure = fact.dims.get("PerformanceMeasureAxis");
    if (measure && !/NAV/i.test(measure)) continue;
    const years = span(fact); const value = number(fact.value);
    if (years && value != null && !fundAverage.has(years)) fundAverage.set(years, value);
  }
  /*
   * The index. A prospectus covering several funds tags each index's returns on
   * its own member with no series to tie it to — Vanguard's ETF prospectus
   * carries the S&P 500 and the total market side by side — so the fund's index
   * is the one whose returns its own track over the same years, within two
   * points a year on every horizon. An active fund's broad comparison index
   * rarely passes that test, and then none is named rather than the wrong one.
   */
  const candidates = new Map<string, Map<number, number>>();
  for (const fact of facts("AvgAnnlRtrPct")) {
    if (fact.dims.has("ClassAxis")) continue;
    const series = fact.dims.get("LegalEntityAxis");
    if (series && series !== `${seriesId}Member`) continue;
    const member = [...fact.dims.values()].find((value) => /Index/i.test(value));
    if (!member) continue;
    const years = span(fact); const value = number(fact.value);
    if (!years || value == null) continue;
    const returns = candidates.get(member) ?? candidates.set(member, new Map()).get(member)!;
    if (!returns.has(years)) returns.set(years, value);
  }
  let indexName: string | null = null;
  let indexAverage = new Map<number, number>();
  let closest = Infinity;
  for (const [member, returns] of candidates) {
    const shared = [...fundAverage].filter(([years]) => returns.has(years));
    if (!shared.length) continue;
    const gaps = shared.map(([years, value]) => Math.abs(value - returns.get(years)!));
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    if (Math.max(...gaps) <= 0.02 && total < closest) { closest = total; indexName = prettyMember(member); indexAverage = returns; }
  }
  const average = [...new Set([...fundAverage.keys(), ...indexAverage.keys()])].sort((left, right) => left - right)
    .map((years) => ({ years, fund: fundAverage.get(years) ?? null, index: indexAverage.get(years) ?? null }));
  const extreme = (value: string, date: string) => {
    const at = etfFirst(ofClass(value))[0];
    const parsed = number(at?.value);
    return parsed == null ? null : { value: parsed, date: etfFirst(ofClass(date))[0]?.value?.trim() ?? null };
  };
  return {
    filed: filing.filed, url: filing.url,
    expenseRatio, managementFee: one(ofClass("ManagementFeesOverAssets")), otherExpenses: one(ofClass("OtherExpensesOverAssets")),
    turnover,
    objective: objective ? stripHtml(objective).slice(0, 1200) : null,
    returns: {
      calendar, average, indexName,
      best: extreme("BarChartHighestQuarterlyReturn", "BarChartHighestQuarterlyReturnDate"),
      worst: extreme("BarChartLowestQuarterlyReturn", "BarChartLowestQuarterlyReturnDate"),
    },
  };
}

/* --- Exposure ------------------------------------------------------------ */

/** Company names compared without their legal suffixes and punctuation. */
export function nameKey(name: string): string {
  return name.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|SA|NV|AG|SE|CLASS [A-Z]|CL [A-Z]|COM|NEW|DEL)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Weights summed by a label, largest first, the rest beyond `limit` as "Other". */
export function exposureBy(holdings: EtfHolding[], label: (holding: EtfHolding) => string | null, limit = 12): Exposure[] {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    const key = label(holding);
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + holding.weight);
  }
  const sorted = [...totals].map(([name, weight]) => ({ label: name, weight })).sort((left, right) => right.weight - left.weight);
  if (sorted.length <= limit) return sorted;
  const rest = sorted.slice(limit - 1).reduce((sum, entry) => sum + entry.weight, 0);
  return [...sorted.slice(0, limit - 1), { label: "Other", weight: rest }];
}

/* --- Fetching ------------------------------------------------------------ */

/** The SEC's register of fund share classes: ticker to trust, series and class. */
export async function fundIdentity(ticker: string, register: () => Promise<{ fields: string[]; data: Array<[number, string, string, string]> }>): Promise<FundIdentity | null> {
  const wanted = ticker.toUpperCase().replace(/\./g, "-");
  const table = await register();
  const row = table.data.find((each) => each[3]?.toUpperCase() === wanted);
  return row ? { ticker: ticker.toUpperCase(), cik: String(row[0]).padStart(10, "0"), seriesId: row[1], classId: row[2] } : null;
}

/** The newest filing of a form for a fund series, from EDGAR's series-level index. */
export async function latestSeriesFiling(seriesId: string, form: string): Promise<{ accession: string; filed: string; folder: string } | null> {
  const response = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${seriesId}&type=${encodeURIComponent(form)}&dateb=&owner=include&count=5&output=atom`, { headers: UA() });
  if (!response.ok) return null;
  const atom = await response.text();
  const href = atom.match(/<filing-href>([^<]+)<\/filing-href>/)?.[1];
  const filed = atom.match(/<filing-date>([^<]+)<\/filing-date>/)?.[1];
  const accession = atom.match(/<accession-number>([^<]+)<\/accession-number>/)?.[1];
  if (!href || !filed || !accession) return null;
  return { accession, filed, folder: href.replace(/\/[^/]+$/, "") };
}

export async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: UA() });
  return response.ok ? response.text() : null;
}

export async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: { ...UA(), Accept: "application/json" } });
  return response.ok ? response.json() as Promise<T> : null;
}
