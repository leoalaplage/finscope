import type { BusinessType, CompanyProfile } from "./types";

/**
 * Economic classifications verified for filers whose generic cash-flow and
 * enterprise-value formulas need a different boundary.
 *
 * The SEC ticker registry carries identity, not an economic classification.
 * Keeping the small set here keyed by CIK makes the decision deterministic for
 * both built-in and dynamically resolved companies, without guessing from a
 * company name or sector label.
 */
const VERIFIED_TYPES_BY_CIK: Readonly<Record<string, BusinessType>> = {
  "0000019617": "bank",       // JPMorgan Chase
  "0001067983": "holding",    // Berkshire Hathaway
  "0001156375": "exchange",   // CME Group
  "0001374310": "exchange",   // Cboe Global Markets
  "0001381197": "broker",     // Interactive Brokers
};

/**
 * Classify an arbitrary filer from the SEC's Standard Industrial
 * Classification. Division H (6000-6799) is finance, insurance and real
 * estate; the narrower groups let us name the models whose balance sheets need
 * a specific treatment. Remaining Division H codes deliberately stay generic
 * `financial` instead of being guessed into a more specific model.
 *
 * A manual CIK decision wins where the broad SIC cannot express the boundary:
 * Berkshire carries an insurance SIC but is analysed as a holding company, and
 * CME/Cboe share a broad code that covers both brokers and exchanges.
 */
/**
 * Which reading of the filings a stored company was built under.
 *
 * A dataset carries the classification it was normalized with, and a change
 * here does not reach one already in the store: Aon would have gone on being
 * read as a bank until its copy expired a week later. Anything built under an
 * older reading is rebuilt by the index rotation rather than waited out.
 *
 * c2: the sixties are no longer financial by default — asset managers,
 *     insurance brokers, property companies, real-estate agencies and royalty
 *     trusts are read as the operating businesses they are.
 * c3: a property company's buildings and an oil company's acreage are read as
 *     its capital expenditure, which eleven companies had none of.
 *
 * It covers what a company *is* and how its filings are read, because both
 * change what a stored dataset says and neither reaches one already stored.
 */
export const CLASSIFICATION_VERSION = "c3";

/**
 * What a filer is, from the industry code it files under.
 *
 * Only the codes where the answer is definite. A code this does not name is
 * not "financial by default" — it is a company this function has nothing to
 * say about, which leaves it read as the operating business it almost always
 * is.
 */
export function businessTypeFromSic(sic: number | string | null | undefined): BusinessType | undefined {
  const code = typeof sic === "string" ? Number.parseInt(sic, 10) : sic;
  if (code == null || !Number.isInteger(code)) return undefined;
  if (code >= 6000 && code <= 6099) return "bank";
  if (code === 6211 || code === 6221) return "broker";
  if (code >= 6300 && code <= 6399) return "insurer";
  if (code === 6719) return "holding";
  if (code === 6200) return "exchange";
  /*
   * Lenders and funds, where the balance sheet really is the business.
   *
   * Credit agencies (6111-6199) lend their own money; investment offices and
   * closed-end funds (6726) hold securities as their inventory. Both belong
   * with the banks.
   */
  if (code >= 6100 && code <= 6199) return "financial";
  if (code === 6726) return "financial";
  /*
   * And everything else in the sixties is an operating business, whatever the
   * range suggests.
   *
   * This used to end with "6000 to 6799 is financial", which is a range, not a
   * judgement — and it quietly withheld every measure from forty-six companies
   * in the index. An asset manager charges a fee on other people's money: it
   * has revenue, an operating margin and free cash flow, and its own balance
   * sheet is small. An insurance broker sells policies it does not underwrite.
   * A property company owns buildings. A real-estate agency collects
   * commissions. Texas Pacific Land collects royalties on oil.
   *
   * None of them is a bank, and calling them one cost Aon, American Tower,
   * Franklin Resources and CBRE their grade entirely — measured, before and
   * after: seventeen of the forty-six became scoreable on figures that had
   * been in their filings the whole time.
   */
  return undefined;
}

export function verifiedBusinessType(cik: string): BusinessType | undefined {
  return VERIFIED_TYPES_BY_CIK[cik.padStart(10, "0")];
}

export function classifyBusiness(profile: CompanyProfile): CompanyProfile {
  const classified = verifiedBusinessType(profile.cik) ?? businessTypeFromSic(profile.sic);
  return classified && classified !== profile.businessType ? { ...profile, businessType: classified } : profile;
}

/**
 * Whether the filer is in the business of money at all.
 *
 * A question about sector, not about arithmetic. It is the right question in
 * exactly one place — whether to strike an operating income out of pre-tax
 * income and interest expense, which is meaningless wherever interest is a cost
 * of goods. It is the wrong question for "does free cash flow mean anything
 * here", and asking it there is what left Cboe and CME at 36% and 26% coverage:
 * both earn fees and buy ordinary equipment, both have a clean decade of free
 * cash flow on their own company pages, and the score refused to look at it.
 * `balanceSheetIsTheBusiness` is that question, and every measure withheld on
 * those grounds asks it.
 *
 * Legacy `financial` remains readable in locally stored watchlists.
 */
export function isFinancialBusiness(type: BusinessType | undefined): boolean {
  return type === "financial" || type === "bank" || type === "broker" || type === "exchange" || type === "insurer" || type === "holding";
}

/**
 * Whether the balance sheet *is* the business.
 *
 * A narrower question than `isFinancialBusiness`, and a different one. A bank's
 * operating cash flow is the movement of its loans and deposits, its borrowings
 * are its raw material rather than its leverage, and its invested capital is
 * other people's money — so free cash flow, net debt and every return struck on
 * invested capital are not conservative estimates of anything, they are
 * category errors. The same holds for a broker, whose customer balances swamp
 * the statement, and for an insurer's float.
 *
 * An exchange is deliberately not on this list even though it is a financial
 * business. Cboe earns fees, pays ordinary costs and buys ordinary equipment:
 * its free cash flow is a real figure that happens to be noisy, because
 * clearing margin moves through the same line. Noisy is a thing to read
 * carefully; meaningless is a thing to withhold. A holding company is left off
 * for the same reason — Berkshire's capital expenditure is railways and
 * utilities, and it is exactly what it looks like.
 */
export function balanceSheetIsTheBusiness(type: BusinessType | undefined): boolean {
  return type === "bank" || type === "broker" || type === "insurer" || type === "financial";
}

export function businessTypeLabel(type: BusinessType | undefined): string {
  switch (type) {
    case "bank": return "bank";
    case "broker": return "broker";
    case "exchange": return "exchange";
    case "insurer": return "insurer";
    case "holding": return "holding company";
    case "financial": return "financial institution";
    default: return "operating company";
  }
}
