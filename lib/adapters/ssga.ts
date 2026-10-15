import { readFirstSheet } from "../xlsx-read";

/**
 * A SPDR fund's own daily files, from State Street Global Advisors.
 *
 * Every US exchange-traded fund must publish its holdings each day on its
 * website (SEC Rule 6c-11); State Street does so as a spreadsheet per fund, and
 * a second one with every day's NAV, shares outstanding and net assets since
 * the fund began. They answer what the SEC's files cannot: the positions of
 * yesterday rather than of two months ago, the holdings of SPY and DIA — unit
 * investment trusts that file no N-PORT — and the money flowing in and out,
 * which is the day's change in shares times the NAV.
 *
 * Read once a day per fund and kept; a file that cannot be read leaves the
 * fund on its SEC filings, and the page says which it is showing.
 */

// The address the published links redirect to, asked for directly: one request rather than two per file.
const BASE = "https://www.ssga.com/library-content/products/fund-data/etfs/us";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; Tenkay research; one request per fund per day)" };

export interface IssuerHolding { name: string; ticker: string | null; cusip: string | null; weight: number; shares: number | null; currency: string | null }
export interface IssuerHoldings { asOf: string; holdings: IssuerHolding[]; source: string }
export interface NavDay { date: string; nav: number; shares: number; netAssets: number }

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** "12-Oct-2026" to "2026-10-12". */
export const isoDate = (text: string) => {
  const match = text.match(/(\d{1,2})-([A-Z][a-z]{2})-(\d{4})/);
  return match && MONTHS[match[2]] ? `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, "0")}` : null;
};
const number = (text: string | undefined) => {
  const parsed = Number((text ?? "").replace(/,/g, ""));
  return text != null && text.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
};

/** The daily holdings sheet: a dated header, then one row per position under a header row naming its columns. */
export function parseSsgaHoldings(rows: string[][], source: string): IssuerHoldings | null {
  const asOf = isoDate(rows.find((row) => /^Holdings:/i.test(row[0] ?? ""))?.[1] ?? "");
  const header = rows.findIndex((row) => row[0] === "Name" && row.includes("Weight"));
  if (!asOf || header < 0) return null;
  const columns = rows[header];
  const at = (name: string) => columns.indexOf(name);
  const holdings: IssuerHolding[] = [];
  for (const row of rows.slice(header + 1)) {
    const name = row[at("Name")]?.trim();
    const weight = number(row[at("Weight")]);
    if (!name || weight == null) continue;
    const ticker = row[at("Ticker")]?.trim();
    const cusip = row[at("Identifier")]?.trim();
    holdings.push({
      name, weight: weight / 100,
      ticker: ticker && ticker !== "-" ? ticker.toUpperCase() : null,
      cusip: cusip && cusip !== "-" ? cusip : null,
      shares: at("Shares Held") >= 0 ? number(row[at("Shares Held")]) : null,
      currency: at("Local Currency") >= 0 ? row[at("Local Currency")]?.trim() || null : null,
    });
  }
  return holdings.length ? { asOf, holdings: holdings.sort((left, right) => right.weight - left.weight), source } : null;
}

/** The NAV history sheet: one row a day, newest first in the file, returned oldest first. */
export function parseSsgaNavHistory(rows: string[][]): NavDay[] {
  const header = rows.findIndex((row) => row[0] === "Date" && row.includes("Shares Outstanding"));
  if (header < 0) return [];
  const columns = rows[header];
  const days: NavDay[] = [];
  for (const row of rows.slice(header + 1)) {
    const date = isoDate(row[0] ?? "");
    const nav = number(row[columns.indexOf("NAV")]);
    const shares = number(row[columns.indexOf("Shares Outstanding")]);
    const netAssets = number(row[columns.indexOf("Total Net Assets")]);
    if (date && nav != null && shares != null && netAssets != null) days.push({ date, nav, shares, netAssets });
  }
  return days.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * One file, asked for once more after a pause if the first answer is not a
 * spreadsheet: the issuer's site sometimes answers a request from a data
 * centre with a page instead of the file, and a second request a moment later
 * is served.
 */
/** What the issuer's site last answered for each file, for the profile to state when a file could not be read. */
export const issuerAnswers = new Map<string, string>();

async function sheet(url: string): Promise<string[][] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 800));
    let response: Response | null = null;
    try {
      response = await fetch(url, { headers: HEADERS, redirect: "follow" });
    } catch (error) {
      issuerAnswers.set(url, `fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const type = response.headers.get("content-type") ?? "";
    if (response.ok && /spreadsheet|octet-stream|excel/i.test(type)) {
      try {
        const rows = await readFirstSheet(await response.arrayBuffer());
        issuerAnswers.set(url, `read ${rows.length} rows`);
        return rows;
      } catch (error) {
        issuerAnswers.set(url, `unreadable: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }
    issuerAnswers.set(url, `${response.status} ${type}`);
    await response.body?.cancel();
  }
  return null;
}

export async function fetchSsgaHoldings(ticker: string): Promise<IssuerHoldings | null> {
  const url = `${BASE}/holdings-daily-us-en-${ticker.toLowerCase()}.xlsx`;
  const rows = await sheet(url).catch(() => null);
  return rows ? parseSsgaHoldings(rows, url) : null;
}

export async function fetchSsgaNavHistory(ticker: string): Promise<NavDay[]> {
  const rows = await sheet(`${BASE}/navhist-us-en-${ticker.toLowerCase()}.xlsx`).catch(() => null);
  return rows ? parseSsgaNavHistory(rows) : [];
}

/** Whether a fund is State Street's, by the name its filings or the SEC give it. */
export const isSsgaFund = (name: string) => /\bSPDR\b|Select Sector|State Street/i.test(name);
