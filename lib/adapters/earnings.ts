import { z } from "zod";
import { secFetch } from "./sec-fetch";

const SEC_AGENT = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";

const EarningsSubmissionsSchema = z.object({
  filings: z.object({
    recent: z.object({
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      accessionNumber: z.array(z.string()),
      items: z.array(z.string()).optional(),
    }),
  }),
});

interface RecentSubmissions {
  form: string[];
  filingDate: string[];
  reportDate: string[];
  accessionNumber: string[];
  items?: string[];
}

export interface EarningsReleaseFiling {
  form: "8-K" | "8-K/A";
  filingDate: string;
  reportDate: string | null;
  accession: string;
  sourceUrl: string;
  preliminary?: PreliminaryEarnings | null;
}

export interface PreliminaryEarningsPeriod {
  label: string;
  periodEnd: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
  dilutedShares: number | null;
  operatingCashFlow: number | null;
  capitalExpenditures: number | null;
  freeCashFlow: number | null;
}

export interface PreliminaryEarnings {
  currency: "USD";
  status: "preliminary-unaudited";
  sourceUrl: string;
  quarter: PreliminaryEarningsPeriod | null;
  annual: PreliminaryEarningsPeriod | null;
}

const FilingIndexSchema = z.object({
  directory: z.object({
    item: z.array(z.object({
      name: z.string(),
      size: z.union([z.string(), z.number()]).optional(),
    })),
  }),
});

const earningsItem = (items: string | undefined) =>
  (items ?? "").split(",").map((item) => item.trim()).includes("2.02");

/**
 * The latest domestic earnings announcement in a filer's recent SEC index.
 *
 * Item 2.02 means "Results of Operations and Financial Condition". Looking
 * for that item rather than merely taking the newest 8-K is essential: a
 * company can file an acquisition, executive change or other current report
 * minutes after its earnings release, as Copart did in September 2026.
 */
export function latestEarningsRelease(recent: RecentSubmissions, cik: string): EarningsReleaseFiling | null {
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = recent.form[index];
    if ((form !== "8-K" && form !== "8-K/A") || !earningsItem(recent.items?.[index])) continue;
    const accession = recent.accessionNumber[index];
    const filingDate = recent.filingDate[index];
    if (!accession || !filingDate) continue;
    const digits = accession.replace(/\D/g, "");
    if (digits.length !== 18) continue;
    return {
      form,
      filingDate,
      reportDate: recent.reportDate[index] || null,
      accession,
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${digits}/`,
    };
  }
  return null;
}

const decodeEntities = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
  .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
  .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (entity) => ({
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">",
  })[entity.toLowerCase()] ?? entity);

const plainText = (value: string) => decodeEntities(value
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

function htmlTables(html: string): string[][][] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((table) =>
    [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => plainText(cell[1])),
    ).filter((row) => row.some(Boolean)),
  );
}

const rowLabel = (row: string[]) => (row.find(Boolean) ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function reportedValues(row: string[]): number[] {
  const values: number[] = [];
  for (let index = 1; index < row.length; index += 1) {
    const cell = row[index].replace(/\u2212/g, "-").trim();
    const match = cell.match(/^([(-])?\$?([\d,]+(?:\.\d+)?)$/);
    if (!match) continue;
    const next = row.slice(index + 1).find(Boolean) ?? "";
    if (/^\)?%$/.test(next)) continue;
    const amount = Number(match[2].replaceAll(",", ""));
    if (!Number.isFinite(amount)) continue;
    values.push(match[1] === "(" || match[1] === "-" ? -amount : amount);
  }
  return values;
}

const valuesFor = (table: string[][], label: string) => {
  const wanted = label.toLowerCase();
  const row = table.find((candidate) => rowLabel(candidate) === wanted);
  return row ? reportedValues(row) : [];
};

const scaled = (value: number | undefined, scale: number) => value == null ? null : value * scale;

function periodEndFrom(html: string): string | null {
  const text = plainText(html);
  const match = text.match(/(?:quarter and year|three months and year) ended ([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]} 12:00:00 UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

/**
 * Read only the headline rows explicitly printed in an earnings exhibit.
 *
 * These are intentionally kept outside the normalized XBRL statements. An
 * exhibit is unaudited and its table labels are presentation, not taxonomy;
 * showing it as a preliminary snapshot makes the new release useful without
 * silently granting it the validation status of a filed 10-Q or 10-K fact.
 */
export function parsePreliminaryEarnings(html: string, sourceUrl: string): PreliminaryEarnings | null {
  const periodEnd = periodEndFrom(html);
  if (!periodEnd) return null;
  const year = periodEnd.slice(0, 4);
  const scale = /\(\s*in thousands\s*\)/i.test(plainText(html)) ? 1_000
    : /\(\s*in millions\s*\)/i.test(plainText(html)) ? 1_000_000
      : 1;
  const tables = htmlTables(html);
  const income = tables.find((table) => {
    const labels = table.map(rowLabel);
    return labels.includes("total service revenues and vehicle sales")
      && labels.includes("diluted net income per common share");
  });
  if (!income) return null;

  const revenue = valuesFor(income, "Total service revenues and vehicle sales");
  const grossProfit = valuesFor(income, "Gross profit");
  const operatingIncome = valuesFor(income, "Operating income");
  const netIncome = valuesFor(income, "Net income attributable to Copart, Inc.");
  const dilutedEps = valuesFor(income, "Diluted net income per common share");
  const dilutedShares = valuesFor(income, "Diluted weighted average common shares outstanding");
  if (revenue.length < 4 || netIncome.length < 4 || dilutedEps.length < 4) return null;

  const cashFlow = tables.find((table) => table.map(rowLabel).includes("net cash provided by operating activities"));
  const operatingCashFlow = cashFlow ? valuesFor(cashFlow, "Net cash provided by operating activities")[0] : undefined;
  const capex = cashFlow ? valuesFor(cashFlow, "Purchases of property and equipment")[0] : undefined;
  const annualOcf = scaled(operatingCashFlow, scale);
  const annualCapex = capex == null ? null : Math.abs(capex * scale);

  const base = {
    periodEnd,
    operatingCashFlow: null,
    capitalExpenditures: null,
    freeCashFlow: null,
  };
  const quarter: PreliminaryEarningsPeriod = {
    ...base,
    label: `Q4 FY${year}`,
    revenue: scaled(revenue[0], scale),
    grossProfit: scaled(grossProfit[0], scale),
    operatingIncome: scaled(operatingIncome[0], scale),
    netIncome: scaled(netIncome[0], scale),
    dilutedEps: scaled(dilutedEps[0], 1),
    dilutedShares: scaled(dilutedShares[0], scale),
  };
  const annual: PreliminaryEarningsPeriod = {
    ...base,
    label: `FY${year}`,
    revenue: scaled(revenue[2], scale),
    grossProfit: scaled(grossProfit[2], scale),
    operatingIncome: scaled(operatingIncome[2], scale),
    netIncome: scaled(netIncome[2], scale),
    dilutedEps: scaled(dilutedEps[2], 1),
    dilutedShares: scaled(dilutedShares[2], scale),
    operatingCashFlow: annualOcf,
    capitalExpenditures: annualCapex,
    freeCashFlow: annualOcf != null && annualCapex != null ? annualOcf - annualCapex : null,
  };

  return { currency: "USD", status: "preliminary-unaudited", sourceUrl, quarter, annual };
}

async function fetchPreliminaryEarnings(filing: EarningsReleaseFiling): Promise<PreliminaryEarnings | null> {
  const indexResponse = await secFetch(`${filing.sourceUrl}index.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!indexResponse.ok) return null;
  const items = FilingIndexSchema.parse(await indexResponse.json()).directory.item;
  const candidates = items
    .filter((item) => /\.html?$/i.test(item.name) && /ex(?:hibit)?[-_]?99(?:[-_.]?1)?/i.test(item.name))
    .sort((left, right) => Number(right.size ?? 0) - Number(left.size ?? 0));
  const exhibit = candidates[0];
  if (!exhibit) return null;
  const sourceUrl = `${filing.sourceUrl}${exhibit.name}`;
  const response = await secFetch(sourceUrl, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "text/html" },
  });
  if (!response.ok) return null;
  return parsePreliminaryEarnings(await response.text(), sourceUrl);
}

/** Read the filing index, not the Company Facts feed that trails the release. */
export async function fetchLatestEarningsRelease(cik: string): Promise<EarningsReleaseFiling | null> {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  const recent = EarningsSubmissionsSchema.parse(await response.json()).filings.recent;
  const filing = latestEarningsRelease(recent, padded);
  if (!filing) return null;
  return { ...filing, preliminary: await fetchPreliminaryEarnings(filing).catch(() => null) };
}

/** Every earnings release in a filer's recent index, newest first, as filing dates. */
export function earningsReleaseDates(recent: RecentSubmissions): string[] {
  const dates = new Set<string>();
  for (let index = 0; index < recent.form.length; index += 1) {
    const form = recent.form[index];
    if ((form === "8-K" || form === "8-K/A") && earningsItem(recent.items?.[index]) && recent.filingDate[index]) {
      dates.add(recent.filingDate[index]);
    }
  }
  return [...dates].sort().reverse();
}

export interface ExpectedRelease { date: string; from: string; to: string; gapDays: number }

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * When the next release should come, from when the last ones did.
 *
 * Not a date anyone announced, and not an analyst's: the median gap between a
 * filer's last few earnings 8-Ks, added to the latest one, with a window of a
 * week either side. A company that reports quarterly lands within a few days
 * of the same week every year, which is all a calendar of the reader's own list
 * needs to say. Anything that does not look quarterly — two releases, or gaps
 * outside two to four months — gets no expectation rather than a wrong one.
 */
export function expectedNextRelease(dates: string[]): ExpectedRelease | null {
  const times = dates.slice(0, 5).map((date) => Date.parse(`${date}T12:00:00Z`)).filter(Number.isFinite);
  if (times.length < 3) return null;
  const gaps = times.slice(0, -1).map((time, index) => (time - times[index + 1]) / DAY_MS).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  if (gap < 60 || gap > 125) return null;
  const expected = times[0] + gap * DAY_MS;
  return { date: isoDay(expected), from: isoDay(expected - 7 * DAY_MS), to: isoDay(expected + 7 * DAY_MS), gapDays: Math.round(gap) };
}

/** The filing dates of a filer's earnings releases, from its SEC submissions index. */
export async function fetchEarningsDates(cik: string): Promise<string[]> {
  const padded = cik.padStart(10, "0");
  const response = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC returned ${response.status}.`);
  return earningsReleaseDates(EarningsSubmissionsSchema.parse(await response.json()).filings.recent);
}
