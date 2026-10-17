import { describe, expect, it } from "vitest";
import { debtFreeSinceFiledZero } from "@/lib/adapters/debt-free";
import type { RawFinancialFact } from "@/lib/types";

const fact = (concept: string, end: string, value: number, start?: string): RawFinancialFact => ({
  metric: "totalDebt", concept, end, value, start, accession: `a-${end}`, currency: "USD", unit: "currency", form: "10-K", filed: end, fiscalYear: 2025, fiscalPeriod: "FY",
} as unknown as RawFinancialFact);

describe("a company that repaid its debt and has borrowed nothing since", () => {
  // Palantir: long-term debt filed as 0 at the end of 2021, nothing tagged since.
  const zero = fact("us-gaap:LongTermDebtNoncurrent", "2021-12-31", 0);
  const liabilities = [fact("us-gaap:Liabilities", "2025-12-31", 1_500e6), fact("us-gaap:Liabilities", "2026-06-30", 1_794e6)];
  const assets = [fact("us-gaap:Assets", "2025-12-31", 8_900e6), fact("us-gaap:Assets", "2026-06-30", 11_679e6)];

  it("owes nothing at every later balance sheet", () => {
    const debt = debtFreeSinceFiledZero(liabilities, [zero], [], [], assets);
    expect(debt.map((entry) => [entry.end, entry.value])).toEqual([["2025-12-31", 0], ["2026-06-30", 0]]);
    expect(debt[0].concept).toBe("Calculated:DebtFreeSinceFiledZero");
  });

  it("is not read as debt-free where a later filing borrows, names a borrowing or pays real interest", () => {
    expect(debtFreeSinceFiledZero(liabilities, [zero, fact("us-gaap:LongTermDebtNoncurrent", "2024-12-31", 500e6)], [], [], assets)).toEqual([]);
    expect(debtFreeSinceFiledZero(liabilities, [zero], [fact("pltr:TermLoanPayable", "2026-06-30", 200e6)], [], assets).map((entry) => entry.end)).toEqual(["2025-12-31"]);
    expect(debtFreeSinceFiledZero(liabilities, [zero], [fact("us-gaap:CapitalLeaseObligationsNoncurrent", "2025-12-31", 300e6)], [], assets).map((entry) => entry.end)).toEqual(["2026-06-30"]);
    expect(debtFreeSinceFiledZero(liabilities, [zero], [], [fact("us-gaap:InterestExpense", "2025-12-31", 90e6, "2025-01-01")], assets).map((entry) => entry.end)).toEqual(["2026-06-30"]);
  });

  it("takes a debt security held as an asset for no borrowing, and needs a balance that states all debt as zero", () => {
    expect(debtFreeSinceFiledZero(liabilities, [zero], [fact("us-gaap:AvailableForSaleSecuritiesDebtSecurities", "2026-06-30", 7_592e6)], [], assets)).toHaveLength(2);
    expect(debtFreeSinceFiledZero(liabilities, [fact("us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "2021-12-31", 0)], [], [], assets)).toEqual([]);
  });
});
