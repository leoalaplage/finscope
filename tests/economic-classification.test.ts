import { describe, expect, it } from "vitest";
import { businessTypeFromSic, classifyBusiness, isFinancialBusiness, verifiedBusinessType } from "../lib/business-type";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { derivedValue } from "../lib/finance";
import type { CompanyProfile } from "../lib/types";

const END = "2025-12-31";
const flow = (value: number, concept = "Revenues") => ({
  units: { USD: [{ start: "2025-01-01", end: END, val: value, accn: "0001-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-13" }] },
  label: concept, description: concept,
});
const point = (value: number, concept: string) => ({
  units: { USD: [{ end: END, val: value, accn: "0001-26-000001", fy: 2025, fp: "FY", form: "10-K", filed: "2026-02-13" }] },
  label: concept, description: concept,
});
const profile = (ticker: string, cik: string): CompanyProfile => ({
  name: ticker, ticker, cik, exchange: "NYSE", currency: "USD", sector: "Unclassified", description: "Test profile", businessType: "operating",
});
const payload = (extra: Record<string, unknown>) => ({ entityName: "Test filer", facts: { "us-gaap": { Revenues: flow(1_000), ...extra } } });

describe("verified economic classification", () => {
  it("classifies audited financial models by CIK, including dynamic SEC companies", () => {
    expect(verifiedBusinessType("19617")).toBe("bank");
    expect(verifiedBusinessType("1067983")).toBe("holding");
    expect(verifiedBusinessType("1156375")).toBe("exchange");
    expect(verifiedBusinessType("1381197")).toBe("broker");
    expect(verifiedBusinessType("320193")).toBeUndefined();
    expect(isFinancialBusiness("bank")).toBe(true);
    expect(isFinancialBusiness("operating")).toBe(false);
  });

  it("classifies dynamically resolved financial filers from their SEC SIC", () => {
    expect(businessTypeFromSic(6021)).toBe("bank");
    expect(businessTypeFromSic("6211")).toBe("broker");
    expect(businessTypeFromSic(6331)).toBe("insurer");
    expect(businessTypeFromSic(6719)).toBe("holding");
    expect(businessTypeFromSic(6798)).toBe("financial");
    expect(businessTypeFromSic(7372)).toBeUndefined();

    expect(classifyBusiness({ ...profile("BAC", "0000070858"), sic: 6021 }).businessType).toBe("bank");
    // The verified CIK remains more precise than a broad industry code.
    expect(classifyBusiness({ ...profile("BRK-B", "0001067983"), sic: 6331 }).businessType).toBe("holding");
  });

  it("builds a financial filing period without requiring industrial revenue", () => {
    const gsProfile = { ...profile("GS", "0000886982"), name: "GOLDMAN SACHS GROUP INC", sic: 6211 };
    const dataset = normalizeSecPayload({ entityName: "The Goldman Sachs Group, Inc.", facts: { "us-gaap": {
      NetIncomeLoss: flow(12_000, "Net income"),
      Assets: point(2_100_000, "Assets"),
      StockholdersEquity: point(120_000, "Stockholders' equity"),
    } } }, "GS", "2026-08-31T00:00:00.000Z", gsProfile);
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(dataset.company.businessType).toBe("broker");
    expect(dataset.company.name).toBe("GOLDMAN SACHS GROUP INC");
    expect(annual.facts.revenue).toBeUndefined();
    expect(annual.facts.netIncome?.value).toBe(12_000);
    expect(annual.facts.totalAssets?.value).toBe(2_100_000);
  });

  it("reads a financial institution's standardized net-revenue line", () => {
    const dataset = normalizeSecPayload({ entityName: "The Goldman Sachs Group, Inc.", facts: { "us-gaap": {
      RevenuesNetOfInterestExpense: flow(53_510, "Revenues net of interest expense"),
      NetIncomeLoss: flow(16_000, "Net income"),
    } } }, "GS", "2026-08-31T00:00:00.000Z", { ...profile("GS", "0000886982"), sic: 6211 });
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.revenue?.value).toBe(53_510);
    expect(annual.facts.revenue?.provenance.concept).toBe("us-gaap:RevenuesNetOfInterestExpense");
  });

  it("rebuilds JPMorgan borrowings from the two non-overlapping filed totals", () => {
    const dataset = normalizeSecPayload(payload({
      LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: point(435_206, "Long-term debt including current maturities"),
      ShortTermBorrowings: point(64_776, "Short-term borrowings"),
    }), "JPM", "2026-08-31T00:00:00.000Z", profile("JPM", "0000019617"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(dataset.company.businessType).toBe("bank");
    expect(annual.facts.totalDebt?.value).toBe(499_982);
    expect(annual.facts.totalDebt?.provenance.formula).toContain("Short-term borrowings");
  });

  it("sums an exchange's long-term, short-term and finance-lease balances", () => {
    const dataset = normalizeSecPayload(payload({
      UnsecuredLongTermDebt: point(3_422.3, "Unsecured long-term debt"),
      ShortTermBorrowings: point(0, "Short-term borrowings"),
      FinanceLeaseLiability: point(46.3, "Finance lease liability"),
    }), "CME", "2026-08-31T00:00:00.000Z", profile("CME", "0001156375"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(dataset.company.businessType).toBe("exchange");
    expect(annual.facts.totalDebt?.value).toBeCloseTo(3_468.6, 10);
  });

  it("uses a lone finance-lease liability as the only filed debt balance", () => {
    const dataset = normalizeSecPayload(payload({
      FinanceLeaseLiability: point(2_705, "Finance lease liability"),
    }), "CPRT", "2026-08-31T00:00:00.000Z", profile("CPRT", "0000900075"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.totalDebt?.value).toBe(2_705);
    expect(annual.facts.totalDebt?.provenance.concept).toBe("us-gaap:FinanceLeaseLiability");
    expect(annual.facts.totalDebt?.provenance.note).toContain("no conventional borrowing");
  });

  it("reconciles two separately filed direct-cost lines before deriving cost of revenue", () => {
    const dataset = normalizeSecPayload(payload({
      OperatingIncomeLoss: flow(380, "Operating income"),
      DirectOperatingCosts: flow(450, "Facility operations"),
      CostDirectMaterial: flow(100, "Cost of vehicle sales"),
      GeneralAndAdministrativeExpense: flow(70, "General and administrative"),
      CostsAndExpenses: flow(620, "Costs and expenses"),
    }), "CPRT", "2026-08-31T00:00:00.000Z", profile("CPRT", "0000900075"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.costOfRevenue?.value).toBe(550);
    expect(annual.facts.costOfRevenue?.provenance.formula).toBe("Direct operating costs + Direct material costs");
    expect(derivedValue(annual, "grossMargin")).toBeCloseTo(.45, 8);
  });

  it("does not combine similarly named direct costs when the statement does not reconcile", () => {
    const dataset = normalizeSecPayload(payload({
      OperatingIncomeLoss: flow(300, "Operating income"),
      DirectOperatingCosts: flow(450, "Direct operating costs"),
      CostDirectMaterial: flow(100, "Direct material costs"),
      GeneralAndAdministrativeExpense: flow(70, "General and administrative"),
      CostsAndExpenses: flow(700, "Costs and expenses"),
    }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.costOfRevenue).toBeUndefined();
  });

  it("reads a lone long-term line as the debt total, and names what it leaves out", () => {
    /*
     * This used to be refused. A sweep of 110 US filers found 27% with no debt
     * total at all — Meta, Home Depot, Caterpillar, McDonald's among them — and
     * none of them is debt-free: each publishes one borrowing balance and not
     * the pair the stricter rule insisted on. A filer with no short-term
     * facility tags no short-term line, and that absence was being read as
     * "unknown" rather than as what the balance sheet shows.
     */
    const dataset = normalizeSecPayload(payload({ LongTermDebt: point(1_491, "Long-term debt") }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(annual.facts.otherLongTermDebt?.value).toBe(1_491);
    expect(annual.facts.totalDebt?.value).toBe(1_491);
    // A single filed balance keeps its own concept and provenance — it is a
    // reading, not a calculation — and the note says what it is and is not.
    expect(annual.facts.totalDebt?.provenance.concept).toBe("us-gaap:LongTermDebt");
    expect(annual.facts.totalDebt?.provenance.note).toContain("Long-term debt as filed, including current maturities");
    expect(annual.facts.totalDebt?.provenance.note).toContain("no separate short-term borrowing");
  });

  it("reads a non-current balance alone when that is all the filer tags", () => {
    // Home Depot and McDonald's tag only a non-current figure at their latest
    // balance-sheet date. It understates by any current maturity, and says so.
    const dataset = normalizeSecPayload(payload({ LongTermDebtNoncurrent: point(39_863, "Non-current long-term debt") }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(annual.facts.totalDebt?.value).toBe(39_863);
    expect(annual.facts.totalDebt?.provenance.note).toContain("Current maturities");
  });

  it("reads a long-term debt total closed by a filed current-debt zero", () => {
    // Adobe publishes 6.21bn of long-term debt — a figure that already contains
    // its current maturities — and states its current debt as zero. The zero is
    // the proof: nothing matures inside the year and there is no short-term
    // borrowing either, so the long-term figure is the whole borrowing and
    // invested capital no longer has to be withheld.
    const dataset = normalizeSecPayload(payload({
      OperatingIncomeLoss: flow(8_706, "Operating income"),
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: flow(8_734, "Income before tax"),
      IncomeTaxExpenseBenefit: flow(1_604, "Income tax expense"),
      LongTermDebt: point(6_210, "Long-term debt"),
      DebtCurrent: point(0, "Current debt"),
      StockholdersEquity: point(11_623, "Stockholders' equity"),
      CashAndCashEquivalentsAtCarryingValue: point(5_431, "Cash and cash equivalents"),
    }), "ADBE", "2026-08-31T00:00:00.000Z", profile("ADBE", "0000796343"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.longTermDebtCurrent?.value).toBe(0);
    expect(annual.facts.longTermDebtCurrent?.provenance.concept).toBe("us-gaap:DebtCurrent");
    expect(annual.facts.totalDebt?.value).toBe(6_210);
    expect(annual.facts.totalDebt?.provenance.formula).toBe("Reported long-term debt, with current debt filed as zero");
    expect(derivedValue(annual, "roic")).toBeCloseTo(.5731, 3);
  });

  it("never adds a current line to a long-term figure that already contains it", () => {
    // `LongTermDebt` includes its current maturities, and `DebtCurrent` is
    // those maturities plus any short-term borrowing. The filing does not say
    // how the current line splits between the two, so the figures are not
    // summed — the long-term balance stands alone and the sum, 6,610, is never
    // published. This is the guarantee that survived opening the rule up.
    const dataset = normalizeSecPayload(payload({
      LongTermDebt: point(6_210, "Long-term debt"),
      DebtCurrent: point(400, "Current debt"),
    }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;
    expect(annual.facts.totalDebt?.value).toBe(6_210);
  });

  it("adds an ambiguous long-term line only when a third filed balance proves its role", () => {
    // Adobe's gross carrying amount is close to current + the balance-sheet
    // long-term line, and materially far from the long-term line alone. That
    // independent identity proves that the latter is non-current here.
    const dataset = normalizeSecPayload(payload({
      LongTermDebt: point(4_802, "Long-term debt"),
      DebtCurrent: point(1_843, "Current debt"),
      DebtInstrumentCarryingAmount: point(6_600, "Gross debt carrying amount"),
    }), "ADBE", "2026-08-31T00:00:00.000Z", profile("ADBE", "0000796343"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.totalDebt?.value).toBe(6_645);
    expect(annual.facts.totalDebt?.provenance.formula).toContain("role validated");
  });

  it("counts one current balance once, whichever concepts name it", () => {
    /*
     * `DebtCurrent` is debt due within a year — short-term borrowing *and* the
     * current maturities of long-term debt — so it is a synonym for the current
     * portion, not something to add beside it. NVIDIA files 999m under both
     * `LongTermDebtCurrent` and `DebtCurrent` for the same date; adding the
     * second reported 9,467m of borrowings against the 8,468m NVIDIA's own
     * long-term-debt tag states, and net debt, enterprise value, ROIC and
     * debt-to-equity all moved with it.
     */
    const dataset = normalizeSecPayload(payload({
      LongTermDebtCurrent: point(999, "Current portion of long-term debt"),
      DebtCurrent: point(999, "Current debt"),
      LongTermDebtNoncurrent: point(7_469, "Non-current long-term debt"),
      LongTermDebt: point(8_468, "Long-term debt"),
    }), "NVDA", "2026-08-31T00:00:00.000Z", profile("NVDA", "0001045810"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.longTermDebtCurrent?.provenance.concept).toBe("us-gaap:LongTermDebtCurrent");
    // And the sum equals the filer's own all-in long-term figure, which is the
    // check that the two halves were the two halves.
    expect(annual.facts.totalDebt?.value).toBe(8_468);
  });

  it("does not add a short-term line the broad current total already contains", () => {
    // `DebtCurrent` covers short-term borrowing as well as current maturities.
    // A filer publishing both must not have the narrower line counted twice.
    const dataset = normalizeSecPayload(payload({
      DebtCurrent: point(100, "Current debt"),
      ShortTermBorrowings: point(60, "Short-term borrowings"),
      LongTermDebtNoncurrent: point(1_000, "Non-current long-term debt"),
    }), "TEST", "2026-08-31T00:00:00.000Z", profile("TEST", "0000000001"));
    const annual = dataset.periods.find((period) => period.periodicity === "annual")!;

    expect(annual.facts.longTermDebtCurrent?.value).toBe(100);
    expect(annual.facts.totalDebt?.value).toBe(1_100);
  });
});
