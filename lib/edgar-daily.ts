import { watchedCompanies } from "./filing-watch";

/**
 * What the companies on this site told the market today.
 *
 * The page carried a general news wire, and on a financial research site it
 * read: ten political headlines, six about wars, one Formula One result and
 * one piece of business news. Counted, not impressions — eighteen items, one
 * of them about a company.
 *
 * This is the replacement, and it is the same material every other figure here
 * comes from: the filings themselves. EDGAR publishes an index of everything
 * accepted each day, so a wire of what five hundred companies actually filed
 * costs one file and no judgement about what matters — the form names say it.
 *
 * Not the "current filings" feed the watcher reads. That one holds the last
 * hundred filings across every filer in America, which on a weekday morning is
 * about a quarter of an hour: it is the right tool for noticing a report
 * minutes after it lands, and the wrong one for saying what a day held.
 */

/**
 * The forms a reader of this site would want to know about.
 *
 * On one ordinary Friday the index's five hundred companies filed 454
 * documents: 264 prospectus supplements, 81 insider transactions, 31 notices
 * of proposed sale, 30 free-writing prospectuses — and eleven that said
 * anything about a business. A wire that lists all of it is the general news
 * wire again, in a different costume.
 *
 * Amendments count, because a restated report is news in a way the original
 * was not.
 */
const INVESTOR_FORMS = [
  "10-K", "10-Q", "8-K", "20-F", "40-F", "6-K",
  "DEF 14A", "DEFA14A", "SC 13D", "SC 13G", "S-1", "S-3", "S-4", "11-K", "25-NSE",
];

/** Whether a form is one of those, allowing the "/A" an amendment carries. */
export function investorForm(form: string): boolean {
  const name = form.trim().toUpperCase();
  return INVESTOR_FORMS.some((wanted) => name === wanted || name === `${wanted}/A`);
}

export interface DailyFiling {
  form: string;
  /** The filer's name as EDGAR holds it, which is not always the company's. */
  name: string;
  cik: string;
  /** The accession number, dashes and all. */
  accession: string;
}

/**
 * One line of EDGAR's daily form index.
 *
 * Fixed-width in intention and ragged in practice, so the columns are read by
 * the shape of what is in them rather than by counting characters: a form
 * name, a company name, a number, a date, a path. A company name contains
 * single spaces and never two, which is what separates the columns.
 */
export function parseDailyIndex(text: string): DailyFiling[] {
  const line = /^(.{1,12}?)\s{2,}(.+?)\s{2,}(\d{1,10})\s+\d{8}\s+edgar\/data\/\d+\/([\d-]+)\.txt\s*$/;
  const filings: DailyFiling[] = [];
  for (const row of text.split(/\r?\n/)) {
    const match = line.exec(row);
    if (!match) continue;
    filings.push({ form: match[1].trim(), name: match[2].trim(), cik: String(Number(match[3])), accession: match[4] });
  }
  return filings;
}

const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (date: Date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
const quarter = (date: Date) => Math.floor(date.getUTCMonth() / 3) + 1;

export const dailyIndexUrl = (date: Date) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${date.getUTCFullYear()}/QTR${quarter(date)}/form.${stamp(date)}.idx`;

export interface FilingsDay {
  /** The day these filings were accepted, which is not always today. */
  date: string;
  filings: Array<DailyFiling & { ticker: string }>;
}

/**
 * The most recent day EDGAR has published, and what our companies filed on it.
 *
 * Walks back from today rather than assuming: there is no index on a Saturday,
 * none on a public holiday, and none for today until the day is over enough
 * for one. Five days back is a long weekend plus a holiday; past that,
 * something is wrong and saying nothing is the right answer.
 */
export async function filingsForLatestDay(now = new Date(), lookBack = 5): Promise<FilingsDay | null> {
  const watched = new Map(watchedCompanies().map((company) => [String(Number(company.cik)), company.ticker]));
  for (let back = 0; back <= lookBack; back++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
    const response = await fetch(dailyIndexUrl(day), {
      headers: { "User-Agent": "FinScope research application leoalaplage@gmail.com" },
    });
    if (!response.ok) continue;
    const filings = parseDailyIndex(await response.text())
      .filter((filing) => investorForm(filing.form) && watched.has(filing.cik))
      .map((filing) => ({ ...filing, ticker: watched.get(filing.cik)! }));
    const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
    return { date, filings };
  }
  return null;
}
