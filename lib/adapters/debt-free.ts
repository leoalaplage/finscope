import type { RawFinancialFact } from "../types";

/** Alternative labels for mutually exclusive operating-liability lines. */
export const OPERATING_LIABILITY_GROUPS = [
  ["AccountsPayableCurrent"],
  ["EmployeeRelatedLiabilitiesCurrent"],
  ["AccruedLiabilitiesAndOtherLiabilities", "AccruedLiabilitiesCurrent", "OtherLiabilitiesCurrent"],
  ["AccruedIncomeTaxesCurrent", "IncomeTaxesPayableCurrent"],
  ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"],
  ["OperatingLeaseLiabilityCurrent"],
  ["DeferredIncomeTaxLiabilitiesNet", "DeferredIncomeTaxLiabilities", "DeferredTaxLiabilitiesNoncurrent"],
  ["OperatingLeaseLiabilityNoncurrent"],
  ["OtherLiabilitiesNoncurrent"],
] as const;

/**
 * An untagged borrowing is zero only when the filed liabilities reconcile
 * entirely to operating obligations. Every line must come from the same
 * balance-sheet date, currency and filing; any borrowing disclosure blocks
 * the inference. A residual is unknown, never a new debt estimate.
 */
export function debtFromReconciledLiabilities(
  totals: RawFinancialFact[], current: RawFinancialFact[],
  groups: RawFinancialFact[][], borrowing: RawFinancialFact[],
  operatingLeases: RawFinancialFact[] = [],
): RawFinancialFact[] {
  const context = (fact: RawFinancialFact) => `${fact.end}|${fact.accession}|${fact.currency}`;
  const indexed = groups.map((group) => {
    const byContext = new Map<string, RawFinancialFact>();
    for (const fact of group) if (!fact.start && !byContext.has(context(fact))) byContext.set(context(fact), fact);
    return byContext;
  });
  const currentByContext = new Map(current.filter((fact) => !fact.start).map((fact) => [context(fact), fact]));
  const hasBorrowing = new Set(borrowing.filter((fact) => !fact.start).map(context));
  const leasesByContext = new Map(operatingLeases.filter((fact) => !fact.start).map((fact) => [context(fact), fact]));
  const out: RawFinancialFact[] = [];
  for (const total of totals) {
    if (total.start || total.value <= 0 || hasBorrowing.has(context(total))) continue;
    const key = context(total);
    const subtotal = currentByContext.get(key);
    if (!subtotal || subtotal.value <= 0) continue;
    const lines = indexed.map((index) => index.get(key));
    const currentLines = lines.slice(0, 6).filter((line): line is RawFinancialFact => line != null);
    const noncurrentLines = lines.slice(6).filter((line): line is RawFinancialFact => line != null);
    if (currentLines.length < 2 || [...currentLines, ...noncurrentLines].some((line) => line.value < 0)) continue;
    const sum = (parts: RawFinancialFact[]) => parts.reduce((value, part) => value + part.value, 0);
    // Only floating-point noise is tolerated: a small unresolved liability
    // cannot be declared zero just because it is immaterial.
    const equal = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 1e-10);
    const currentResidual = subtotal.value - sum(currentLines);
    const noncurrentResidual = total.value - subtotal.value - sum(noncurrentLines);
    const lease = leasesByContext.get(key);
    const reconciled = equal(currentResidual, 0) && equal(noncurrentResidual, 0);
    // Some quarterly reports tag only the combined operating lease balance.
    // It may close both residuals only if neither split has also been counted.
    const unsplitLease = !lines[5] && !lines[7] && lease && lease.value >= 0
      && currentResidual >= 0 && noncurrentResidual >= 0
      && equal(currentResidual + noncurrentResidual, lease.value);
    if (!reconciled && !unsplitLease) continue;
    out.push({
      ...total, metric: "totalDebt", value: 0,
      concept: "Calculated:DebtFromReconciledLiabilities",
      summedFrom: ["Liabilities − reconciled operating liabilities = 0"],
      normalizationNote: `No borrowing line is filed at this date. Current and total liabilities reconcile exactly to ${[...currentLines, ...noncurrentLines, ...(unsplitLease ? [lease] : [])].map((line) => line.concept).join(", ")} in the same filing. Operating leases are operating obligations, excluded from financial debt.`,
    });
  }
  return out;
}

/** Balances that state all of a company's borrowing: one of them filed as exactly zero says it owes nothing. */
export const ZERO_PROOF_CONCEPTS = ["DebtLongtermAndShorttermCombinedAmount", "LongTermDebt", "LongTermDebtNoncurrent", "DebtInstrumentCarryingAmount", "LongTermDebtAndCapitalLeaseObligations"];

/** A line that names a borrowing, in any taxonomy: the company's own included. */
export const NAMES_A_BORROWING = /debt|borrow|loan|notespayable|lines?ofcredit|creditfacilit|commercialpaper|convertible|seniornote|subordinated|debenture|bonds?payable|financelease|capitallease/i;
/** The same words on the asset side, or about a borrowing rather than its balance. */
const NOT_A_BALANCE_OWED = /securit|investment|receivable|asset|available|heldtomaturity|expense|cost|discount|premium|issuance|proceeds|repayment|interest|fairvalue|unamortized|maturit|capacity|covenant|ratio|percent|rate|gain|loss|extinguishment|writeoff|forgiv/i;

/**
 * A company that repaid what it owed and has borrowed nothing since: its debt is zero, not unknown.
 *
 * Palantir filed its long-term debt as 0 at the end of 2021, having repaid a $200m term loan, and has tagged no
 * borrowing since: every later balance sheet left its debt blank, and the site showed "—" for a company with none.
 * Absence alone proves nothing (a missing tag is this site's recurring failure), so three things must hold at the
 * balance-sheet date: a balance that states all borrowing was filed as exactly zero at an earlier date, with no
 * borrowing above zero filed since; no line of that filing, in any taxonomy, names a borrowing; and the interest the
 * period carries is under a quarter of a percent of total assets, a facility's fees and not a loan's cost.
 */
export function debtFreeSinceFiledZero(
  totals: RawFinancialFact[], borrowing: RawFinancialFact[], named: RawFinancialFact[],
  interest: RawFinancialFact[], assets: RawFinancialFact[],
): RawFinancialFact[] {
  const instant = (fact: RawFinancialFact) => !fact.start;
  const zeros = borrowing.filter((fact) => instant(fact) && fact.value === 0 && ZERO_PROOF_CONCEPTS.includes(fact.concept.replace(/^us-gaap:/, "")))
    .filter((zero) => !borrowing.some((other) => instant(other) && other.end === zero.end && other.value > 0));
  if (!zeros.length) return [];
  const owed = borrowing.filter((fact) => instant(fact) && fact.value > 0);
  const namedAt = new Set(named.filter((fact) => instant(fact) && fact.value !== 0 && !NOT_A_BALANCE_OWED.test(fact.concept.replace(/^[^:]+:/, ""))).map((fact) => fact.end));
  const tagged = new Set(borrowing.filter(instant).map((fact) => fact.end));
  const out: RawFinancialFact[] = [];
  for (const total of totals) {
    if (!instant(total) || total.value <= 0 || tagged.has(total.end) || namedAt.has(total.end)) continue;
    const zero = zeros.filter((fact) => fact.end <= total.end).sort((left, right) => right.end.localeCompare(left.end))[0];
    if (!zero || owed.some((fact) => fact.end > zero.end && fact.end <= total.end)) continue;
    const assetsAt = assets.find((fact) => instant(fact) && fact.end === total.end)?.value;
    const year = 400 * 86_400_000;
    const carried = interest.filter((fact) => fact.start && fact.end === total.end && Date.parse(fact.end) - Date.parse(fact.start) <= year);
    if (!assetsAt || assetsAt <= 0 || carried.some((fact) => fact.value > assetsAt * 0.0025)) continue;
    out.push({
      ...total, metric: "totalDebt", value: 0,
      concept: "Calculated:DebtFreeSinceFiledZero",
      summedFrom: [`${zero.concept.replace(/^us-gaap:/, "")} = 0 at ${zero.end}; no borrowing filed since`],
      normalizationNote: `No borrowing line is filed at this date. ${zero.concept.replace(/^us-gaap:/, "")} was filed as 0 at ${zero.end}, no borrowing above zero has been filed since, no line of this filing names one, and the period's interest is under 0.25% of total assets.`,
    });
  }
  return out;
}
