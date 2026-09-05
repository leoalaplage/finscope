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
export function businessTypeFromSic(sic: number | string | null | undefined): BusinessType | undefined {
  const code = typeof sic === "string" ? Number.parseInt(sic, 10) : sic;
  if (code == null || !Number.isInteger(code)) return undefined;
  if (code >= 6000 && code <= 6099) return "bank";
  if (code === 6211 || code === 6221) return "broker";
  if (code >= 6300 && code <= 6399) return "insurer";
  if (code === 6719) return "holding";
  if (code >= 6000 && code <= 6799) return "financial";
  return undefined;
}

export function verifiedBusinessType(cik: string): BusinessType | undefined {
  return VERIFIED_TYPES_BY_CIK[cik.padStart(10, "0")];
}

export function classifyBusiness(profile: CompanyProfile): CompanyProfile {
  const classified = verifiedBusinessType(profile.cik) ?? businessTypeFromSic(profile.sic);
  return classified && classified !== profile.businessType ? { ...profile, businessType: classified } : profile;
}

/** Legacy `financial` remains readable in locally stored watchlists. */
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
