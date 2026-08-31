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

export function verifiedBusinessType(cik: string): BusinessType | undefined {
  return VERIFIED_TYPES_BY_CIK[cik.padStart(10, "0")];
}

export function classifyBusiness(profile: CompanyProfile): CompanyProfile {
  const verified = verifiedBusinessType(profile.cik);
  return verified && verified !== profile.businessType ? { ...profile, businessType: verified } : profile;
}

/** Legacy `financial` remains readable in locally stored watchlists. */
export function isFinancialBusiness(type: BusinessType | undefined): boolean {
  return type === "financial" || type === "bank" || type === "broker" || type === "exchange" || type === "insurer" || type === "holding";
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
