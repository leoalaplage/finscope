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
