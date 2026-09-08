/**
 * What the people who run a company did with their own shares.
 *
 * Every officer, director and ten-per-cent owner must report a change in their
 * holding on Form 4 within two business days, and the form is XML. It is a
 * primary source, filed under oath, with no vendor between it and this page —
 * which is the only kind of fact this application carries.
 *
 * The whole value of reading it is in one distinction. Most Form 4 rows are not
 * decisions: a grant vests, an option is exercised, shares are withheld to pay
 * the tax on that exercise. A tool that adds those up announces "insider
 * selling" every quarter at every company on earth, because compensation is
 * paid in stock and stock has to be sold to pay tax on it. Only an open-market
 * purchase or sale is somebody choosing, with their own money, to own more or
 * less of the thing they run. The two are separated here and never summed.
 */

const SEC_AGENT = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";

/** How many recent Form 4s are read for one company. */
export const INSIDER_FILING_LIMIT = 40;

/**
 * What a transaction code means, in the terms a reader thinks in.
 *
 * The letters are the SEC's own (Table I of the Form 4 instructions). The
 * grouping is the editorial judgement, and it is the point of the feature:
 * `open-market` is a decision, everything else is the machinery of being paid
 * in stock.
 */
export type InsiderKind = "open-market" | "award" | "exercise" | "tax" | "gift" | "other";

const KINDS: Record<string, { kind: InsiderKind; label: string }> = {
  P: { kind: "open-market", label: "Open-market purchase" },
  S: { kind: "open-market", label: "Open-market sale" },
  A: { kind: "award", label: "Grant or award" },
  M: { kind: "exercise", label: "Option exercise" },
  X: { kind: "exercise", label: "Derivative exercise" },
  C: { kind: "exercise", label: "Conversion" },
  F: { kind: "tax", label: "Shares withheld for tax" },
  D: { kind: "other", label: "Disposition to the issuer" },
  G: { kind: "gift", label: "Gift" },
  V: { kind: "other", label: "Reported early, voluntarily" },
};

export interface InsiderTransaction {
  /** The day it happened, which is not the day it was filed. */
  date: string;
  filedAt: string;
  owner: string;
  /** Officer, director, ten-per-cent owner — as the filer declared it. */
  role: string;
  code: string;
  kind: InsiderKind;
  codeLabel: string;
  security: string;
  shares: number | null;
  price: number | null;
  /** Shares times price, and nothing where either is unfiled. */
  value: number | null;
  direction: "acquired" | "disposed";
  sharesAfter: number | null;
  accession: string;
  sourceUrl: string;
}

export interface InsiderRecord {
  ticker: string;
  cik: string;
  retrievedAt: string;
  /** Newest first. */
  transactions: InsiderTransaction[];
  /** How many Form 4s were read, and how many the company has recently filed. */
  filingsRead: number;
  filingsAvailable: number;
}

/* --- A very small XML reader ----------------------------------------------
 *
 * The Workers runtime has no DOM, and a Form 4 is three kilobytes of regular,
 * unnamespaced XML with no attributes worth reading. A general parser would be
 * a dependency and a surface; these four functions are the whole of what the
 * form needs, and they return nothing rather than guessing when a tag is
 * absent — which is the same rule every other figure on this site follows.
 */

const blocks = (xml: string, tag: string): string[] =>
  [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);

const text = (xml: string, tag: string): string | null => {
  const found = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!found) return null;
  // A Form 4 wraps most values in <value>, and footnote-only tags have none.
  const inner = /<value\b[^>]*>([\s\S]*?)<\/value>/.exec(found[1]);
  const raw = (inner ? inner[1] : found[1]).trim();
  return raw.includes("<") ? null : (raw || null);
};

const number = (xml: string, tag: string): number | null => {
  const raw = text(xml, tag);
  if (raw == null) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

const flag = (xml: string, tag: string) => {
  const raw = text(xml, tag);
  return raw === "true" || raw === "1";
};

/** How the filer described themselves, in the order a reader cares about. */
function roleOf(xml: string): string {
  const parts: string[] = [];
  const title = text(xml, "officerTitle");
  if (flag(xml, "isOfficer")) parts.push(title ? `Officer · ${title}` : "Officer");
  if (flag(xml, "isDirector")) parts.push("Director");
  if (flag(xml, "isTenPercentOwner")) parts.push("10% owner");
  if (flag(xml, "isOther")) parts.push(text(xml, "otherText") ?? "Other");
  return parts.join(" · ") || "Not stated";
}

/**
 * One Form 4, as the transactions it reports.
 *
 * Only the non-derivative table is read. The derivative table holds options and
 * restricted units, whose "price" is a strike rather than anything paid, and
 * mixing the two produces a total that is not a sum of comparable things.
 */
export function parseForm4(xml: string, accession: string, filedAt: string, sourceUrl: string): InsiderTransaction[] {
  const owner = blocks(xml, "reportingOwner")[0] ?? "";
  const name = text(owner, "rptOwnerName") ?? "Not stated";
  const role = roleOf(owner);
  return blocks(xml, "nonDerivativeTransaction").flatMap((row) => {
    const date = text(row, "transactionDate");
    const code = text(row, "transactionCode");
    if (!date || !code) return [];
    const known = KINDS[code];
    const shares = number(row, "transactionShares");
    const price = number(row, "transactionPricePerShare");
    return [{
      date,
      filedAt,
      owner: name,
      role,
      code,
      kind: known?.kind ?? "other",
      codeLabel: known?.label ?? `Code ${code}`,
      security: text(row, "securityTitle") ?? "Not stated",
      shares,
      price,
      // A grant has no price, and nought is not a price. Absent stays absent.
      value: shares != null && price != null ? shares * price : null,
      direction: text(row, "transactionAcquiredDisposedCode") === "A" ? "acquired" as const : "disposed" as const,
      sharesAfter: number(row, "sharesOwnedFollowingTransaction"),
      accession,
      sourceUrl,
    }];
  });
}

interface Submission { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] }

/**
 * The recent Form 4 filings a company's own submissions index lists.
 *
 * The document name comes from the index and is never assumed. Every filing
 * agent names the file differently — Apple's is `form4.xml`, JPMorgan's
 * `doc4.xml`, NVIDIA's and Palantir's `wk-form4_1788901755.xml` — so a guessed
 * name reads one company and silently returns nothing for the rest. That is
 * exactly what it did: JPMorgan reported forty filings read and no transactions
 * in them, which looks like a company whose insiders did nothing.
 *
 * `primaryDocument` points at the human-readable rendering, `xslF345X06/…`.
 * The XML behind it is the same name in the filing's own directory, so the
 * rendering prefix is dropped and nothing else is invented.
 */
export function recentForm4s(recent: Submission, limit = INSIDER_FILING_LIMIT) {
  const found: Array<{ accession: string; filedAt: string; document: string }> = [];
  for (let index = 0; index < recent.form.length; index += 1) {
    if (recent.form[index] !== "4") continue;
    const document = (recent.primaryDocument?.[index] ?? "").replace(/^xsl[^/]*\//, "");
    if (!document.endsWith(".xml")) continue;
    found.push({ accession: recent.accessionNumber[index], filedAt: recent.filingDate[index], document });
    if (found.length >= limit) break;
  }
  return found;
}

const form4Url = (cik: string, accession: string, document: string) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${document}`;

/**
 * Every recent Form 4 for one company, read from EDGAR.
 *
 * Capped, because a company files hundreds and a page needs the recent ones;
 * the count of what was read and what exists travels with the answer so the
 * page can say "the last forty" rather than implying it is all of them.
 *
 * One failed document costs that document. A Form 4 that will not parse is not
 * a reason to show nothing about the other thirty-nine.
 */
export async function fetchInsiderTransactions(
  ticker: string,
  cik: string,
  retrievedAt = new Date().toISOString(),
  limit = INSIDER_FILING_LIMIT,
): Promise<InsiderRecord> {
  const padded = cik.padStart(10, "0");
  const response = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { "User-Agent": SEC_AGENT(), Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`EDGAR returned ${response.status} for the filing index of ${ticker}.`);
  const body = await response.json() as { filings?: { recent?: Submission } };
  const recent = body.filings?.recent;
  if (!recent?.form) return { ticker, cik: padded, retrievedAt, transactions: [], filingsRead: 0, filingsAvailable: 0 };

  const available = recent.form.filter((form) => form === "4").length;
  const wanted = recentForm4s(recent, limit);

  /*
   * Read a few at a time. The SEC asks for no more than ten requests a second
   * and says so in writing; a page that fetched forty documents at once would
   * be answered with a block, which is a self-inflicted outage.
   */
  const transactions: InsiderTransaction[] = [];
  for (let start = 0; start < wanted.length; start += 5) {
    const batch = await Promise.all(wanted.slice(start, start + 5).map(async ({ accession, filedAt, document }) => {
      try {
        const url = form4Url(padded, accession, document);
        const response = await fetch(url, { headers: { "User-Agent": SEC_AGENT() } });
        if (!response.ok) return [];
        return parseForm4(await response.text(), accession, filedAt, url);
      } catch {
        return [];
      }
    }));
    for (const rows of batch) transactions.push(...rows);
  }

  transactions.sort((left, right) => right.date.localeCompare(left.date) || right.filedAt.localeCompare(left.filedAt));
  return { ticker, cik: padded, retrievedAt, transactions, filingsRead: wanted.length, filingsAvailable: available };
}
