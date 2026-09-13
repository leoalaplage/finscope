import { describe, expect, it } from "vitest";
import { QS_COLUMNS, qsPriceInputs, qsRow, qsTable, qsValuationColumns } from "../lib/qs-export";
import { derivedValue } from "../lib/finance";
import { balanceSheetHealth } from "../lib/statement-flows";
import type { CompanyDataset, FinancialPeriod, MetricKey } from "../lib/types";

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(periodicity: FinancialPeriod["periodicity"], periodEnd: string, facts: Partial<Record<MetricKey, number>>): FinancialPeriod {
  return {
    label: `${periodicity} ${periodEnd}`, fiscalYear: Number(periodEnd.slice(0, 4)), periodEnd, periodicity,
    filingDate: "2026-02-01", accession: "acc", currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: "currency", periodEnd, periodicity, fiscalYear: Number(periodEnd.slice(0, 4)), provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const business = {
  revenue: 1_000, grossProfit: 600, operatingIncome: 300, netIncome: 200,
  operatingCashFlow: 300, capitalExpenditures: 100, incomeTaxExpense: 60,
  totalDebt: 400, totalEquity: 600, totalAssets: 1_500, cashAndEquivalents: 200,
  currentAssets: 500, currentLiabilities: 250, dilutedShares: 100, sharesOutstanding: 100,
  depreciationAndAmortization: 50, stockBasedCompensation: 40, interestExpense: 20,
};

const dataset = (periods: FinancialPeriod[]): CompanyDataset => ({
  company: { ticker: "T", name: "Test Inc.", currency: "USD", exchange: "NYSE", cik: "1", sector: "Software", description: "", businessType: "domestic" } as unknown as CompanyDataset["company"],
  periods, retrievedAt: "now", warnings: [],
});

const years = (count: number) => Array.from({ length: count }, (_, index) =>
  period("annual", `${2021 + index}-12-31`, { ...business, revenue: 1_000 * 1.1 ** index }));

const company = dataset([...years(5), period("ttm", "2026-06-30", business)]);

describe("the watchlist as the screener's table", () => {
  it("writes a percentage as a number out of a hundred, which is what the parser reads", () => {
    // The screener's own parser strips a % sign and divides by 100 when it
    // compounds. A fraction here would score every company as if it earned
    // less than one percent on capital.
    const row = qsRow(company, 50).values;
    const period = company.periods.at(-1)!;
    expect(row["Operating Margin"]).toBeCloseTo(derivedValue(period, "operatingMargin")! * 100, 8);
    expect(row["Operating Margin"]).toBeCloseTo(30, 8);
  });

  it("writes money in billions, which is what the column is titled", () => {
    const row = qsRow(dataset([period("ttm", "2026-06-30", { ...business, operatingCashFlow: 3.2e9, capitalExpenditures: 4e8 })]), null).values;
    expect(row["OCF"]).toBeCloseTo(3.2, 8);
    expect(row["Capex"]).toBeCloseTo(.4, 8);
  });

  it("states capital expenditure as an outflow's magnitude, whichever sign the filer used", () => {
    const negative = qsRow(dataset([period("ttm", "2026-06-30", { ...business, capitalExpenditures: -1e8 })]), null).values;
    expect(negative["Capex"]).toBeCloseTo(.1, 8);
  });

  it("finishes the valuation columns from a live price, never a stored one", () => {
    const inputs = qsPriceInputs(company);
    const cheap = qsValuationColumns(inputs, 10);
    const dear = qsValuationColumns(inputs, 40);
    expect(cheap["Market Cap"]).toBeLessThan(dear["Market Cap"]!);
    expect(cheap["FCF Yield"]).toBeGreaterThan(dear["FCF Yield"]!);
    // 100 shares at $10 is 1,000 of market value, plus 200 of net debt.
    expect(cheap["EV/EBIT"]).toBeCloseTo(1_200 / 300, 8);
  });

  it("uses the latest filed annual debt when a TTM balance omits an immaterial lease", () => {
    const annual = period("annual", "2025-12-31", { ...business, totalDebt: 3 });
    const current = period("ttm", "2026-06-30", { ...business });
    delete current.facts.totalDebt;
    current.facts.interestPaid = {
      ...current.facts.interestExpense!, metric: "interestPaid", value: 2,
    };
    delete current.facts.interestExpense;
    const row = qsRow(dataset([annual, current]), 50).values;

    expect(row["ROIC"]).not.toBeNull();
    expect(row["Net Debt / EBITDA"]).toBeCloseTo((3 - 200) / 350, 8);
    expect(row["Long-term Debt to Assets"]).toBeCloseTo(3 / 1_500, 8);
    expect(row["EBIT / Interest Expense"]).toBe(150);
    expect(row["EV/EBIT"]).not.toBeNull();
    expect(row["EV/FCF"]).not.toBeNull();
  });

  it("uses average invested capital for native ROIC when an opening balance is filed", () => {
    const opening = period("annual", "2024-12-31", { ...business, totalDebt: 100, totalEquity: 500, cashAndEquivalents: 100 });
    const closing = period("annual", "2025-12-31", { ...business, totalDebt: 300, totalEquity: 700, cashAndEquivalents: 200 });
    const row = qsRow(dataset([opening, closing]), null).values;
    // NOPAT is 300 × (1 − 21%) = 237. Invested capital averages 500 and 800.
    expect(row["ROIC"]).toBeCloseTo(237 / 650 * 100, 8);
  });

  it("prefers filed long-term debt components over total debt for debt-to-assets", () => {
    const current = period("ttm", "2026-06-30", {
      ...business, totalDebt: 500, totalAssets: 1_000,
      longTermDebtCurrent: 20, longTermDebtNoncurrent: 200,
    });
    const row = qsRow(dataset([current]), null).values;
    expect(row["Long-term Debt to Assets"]).toBeCloseTo(0.22, 8);
  });

  it("leaves the valuation columns empty without a price rather than guessing one", () => {
    const row = qsRow(company, null).values;
    for (const column of ["Market Cap", "EV/EBIT", "EV/FCF", "FCF Yield"]) expect(row[column]).toBeNull();
    // The pillars that need no price still score.
    expect(row["ROIC"]).not.toBeNull();
    expect(row["Current Ratio"]).not.toBeNull();
  });

  it("withholds industrial capital and cash-flow measures for a bank", () => {
    const bank = { ...company, company: { ...company.company, businessType: "bank" as const } };
    const row = qsRow(bank, 50).values;
    for (const column of ["ROIC", "ROIC 5Yr Avg", "FCF Margin 5Yr Avg", "FCF / Net Income", "Net Debt / EBITDA", "Long-term Debt to Assets", "OCF/Capex", "FCF 5Y CAGR", "EV/EBIT", "EV/FCF", "FCF Yield", "OCF", "Capex"]) {
      expect(row[column], column).toBeNull();
    }
    expect(row["Operating Margin"]).not.toBeNull();
    expect(row["Market Cap"]).not.toBeNull();
  });

  it("omits the forward-looking columns instead of inventing estimates", () => {
    for (const column of ["Revenue Forward 3Y CAGR", "Forward P/FCF", "PEG"]) {
      expect(QS_COLUMNS).not.toContain(column);
    }
  });

  it("renders a table the parser can read, with an empty cell for anything missing", () => {
    const table = qsTable([qsRow(company, 50), qsRow(dataset([period("ttm", "2026-06-30", { revenue: 1_000 })]), null)]);
    const [header, ...rows] = table.split("\n");
    expect(header.split(",")).toEqual([...QS_COLUMNS]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.split(",")).toHaveLength(QS_COLUMNS.length);
    // A company with almost nothing reported writes blanks, not zeros.
    expect(rows[1].split(",")[QS_COLUMNS.indexOf("ROIC")]).toBe("");
  });

  it("quotes a sector that would otherwise split its own row", () => {
    const awkward = dataset([period("ttm", "2026-06-30", business)]);
    awkward.company = { ...awkward.company, sector: "Retail, online" };
    const row = qsTable([qsRow(awkward, null)]).split("\n")[1];
    expect(row).toContain('"Retail, online"');
    expect(row.split(",").length).toBeGreaterThan(QS_COLUMNS.length - 1);
  });

  it("agrees with the figures the rest of the application shows", () => {
    // The screener must never disagree with the company page about the same
    // company, so every column defers to the same derivation.
    const period = company.periods.at(-1)!;
    const row = qsRow(company, 50).values;
    expect(row["ROIC"]).toBeCloseTo(derivedValue(period, "roic")! * 100, 8);
    expect(row["Current Ratio"]).toBeCloseTo(balanceSheetHealth(period).find((item) => item.key === "currentRatio")!.value!, 8);
    expect(row["FCF / Net Income"]).toBeCloseTo(derivedValue(period, "cashConversion")! * 100, 8);
    expect(row["EBIT / Interest Expense"]).toBeCloseTo(derivedValue(period, "interestCoverage")!, 8);
  });
});

/**
 * Two silences that were being read as ignorance.
 *
 * Both cost companies their grade entirely, and both were measured against the
 * whole index before they were touched: twenty companies with no borrowings,
 * and four that report an operating income once a year and never in a quarter.
 */
describe("what a filing does not say", () => {
  const debtFree = { ...business, totalDebt: undefined, interestExpense: undefined } as Partial<Record<MetricKey, number>>;
  const withoutDebt = (count: number) => Array.from({ length: count }, (_, index) =>
    period("annual", `${2021 + index}-12-31`, { ...debtFree, revenue: 1_000 * 1.1 ** index }));

  it("reads a company that owes nothing as owing nothing, not as unknown", () => {
    /*
     * Intuitive Surgical, Garmin, Monolithic Power, Expeditors and Align have
     * never borrowed. Their net debt is not unknown: it is minus their cash,
     * which is the most important thing about a balance sheet with no
     * borrowings on it.
     */
    const row = qsRow(dataset([...withoutDebt(5), period("ttm", "2026-06-30", debtFree)]), 50).values;
    const ebitda = derivedValue(period("ttm", "2026-06-30", debtFree), "ebitda")!;
    expect(row["Net Debt / EBITDA"]).toBeCloseTo(-200 / ebitda, 6);
    expect(row["ROIC"]).not.toBeNull();
  });

  it("still refuses where the silence is not evidence", () => {
    // Two parsed balance sheets are not three, and a debt-free reading has to
    // be earned: NVIDIA files no capital expenditure before 2022, and reading
    // that absence as a zero would invent six years of free cash flow.
    const thin = dataset([...withoutDebt(2), period("ttm", "2026-06-30", debtFree)]);
    expect(qsRow(thin, 50).values["Net Debt / EBITDA"]).toBeNull();
  });

  it("scores on the last year reported where no trailing window carries the figure", () => {
    /*
     * A trailing window is built from quarters. A filer that states an
     * operating income once a year and never in a quarter has none in any
     * trailing window ever, so walking back through them finds nothing however
     * far it goes — TJX, Sherwin-Williams, PPG and ConocoPhillips each had no
     * grade at all because the score asked the one window that could not answer.
     */
    const quarterly = { ...business, operatingIncome: undefined } as Partial<Record<MetricKey, number>>;
    const mixed = dataset([...years(5), period("ttm", "2026-06-30", quarterly)]);
    expect(qsRow(mixed, 50).period?.label).toBe("annual 2025-12-31");
    // Struck on that year's own figures: three hundred of operating income on
    // the revenue it actually reported, not on the trailing window's.
    expect(qsRow(mixed, 50).values["Operating Margin"]).toBeCloseTo(300 / (1_000 * 1.1 ** 4) * 100, 6);
  });

  it("will not reach back to a year that has stopped describing the company", () => {
    // Eighteen months, so a grade is struck on the last year rather than on a
    // year the business has moved on from.
    const stale = dataset([period("annual", "2021-12-31", business), period("ttm", "2026-06-30", { ...business, operatingIncome: undefined })]);
    expect(qsRow(stale, 50).values["Operating Margin"]).toBeNull();
  });
});
