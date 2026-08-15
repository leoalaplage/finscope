import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { layoutSankey, ribbonPath } from "../lib/sankey";
import { balanceSheetDiagram, balanceSheetHealth, cashFlowDiagram, incomeStatementDiagram } from "../lib/statement-flows";
import type { FinancialPeriod, MetricKey } from "../lib/types";

const provenance = { provider: "SEC" as const, sourceUrl: "sec", retrievedAt: "now", concept: "Test", status: "reported" as const };

function period(facts: Partial<Record<MetricKey, number>>): FinancialPeriod {
  return {
    label: "FY 2025", fiscalYear: 2025, periodEnd: "2025-12-31", periodicity: "annual",
    filingDate: "2026-02-01", accession: "acc", currency: "USD",
    facts: Object.fromEntries(Object.entries(facts).map(([metric, value]) => [metric, {
      metric, value, currency: "USD", unit: "currency", periodEnd: "2025-12-31", periodicity: "annual", fiscalYear: 2025, provenance,
    }])) as FinancialPeriod["facts"],
  };
}

const sum = (flows: Array<{ source: string; target: string; value: number }>, id: string, side: "source" | "target") =>
  flows.filter((flow) => flow[side] === id).reduce((total, flow) => total + flow.value, 0);

describe("sankey layout", () => {
  const flows = [
    { source: "revenue", target: "cost", value: 40 },
    { source: "revenue", target: "gross", value: 60 },
    { source: "gross", target: "opex", value: 25 },
    { source: "gross", target: "operating", value: 35 },
  ];

  it("places a node to the right of everything that feeds it", () => {
    const layout = layoutSankey(flows, { width: 600, height: 300 });
    const depth = Object.fromEntries(layout.nodes.map((node) => [node.id, node.depth]));
    expect(depth.revenue).toBe(0);
    expect(depth.gross).toBe(1);
    expect(depth.operating).toBe(2);
    expect(layout.nodes.find((node) => node.id === "operating")!.x)
      .toBeGreaterThan(layout.nodes.find((node) => node.id === "revenue")!.x);
  });

  it("scales every column against one vertical scale, so equal widths mean equal money", () => {
    const layout = layoutSankey(flows, { width: 600, height: 300 });
    const revenue = layout.nodes.find((node) => node.id === "revenue")!;
    const gross = layout.nodes.find((node) => node.id === "gross")!;
    // Gross profit is 60% of revenue, so its box must be 60% of the height.
    expect(gross.height / revenue.height).toBeCloseTo(.6, 2);
  });

  it("stacks the links leaving a node without overlapping them", () => {
    const layout = layoutSankey(flows, { width: 600, height: 300 });
    const leaving = layout.links.filter((link) => link.source === "revenue");
    expect(leaving).toHaveLength(2);
    expect(leaving[0].sourceY + leaving[0].thickness).toBeCloseTo(leaving[1].sourceY, 6);
  });

  it("ignores a flow that is zero, negative or not a number", () => {
    const layout = layoutSankey([...flows, { source: "gross", target: "ghost", value: 0 }, { source: "gross", target: "void", value: -5 }], { width: 600, height: 300 });
    expect(layout.nodes.map((node) => node.id)).not.toContain("ghost");
    expect(layout.nodes.map((node) => node.id)).not.toContain("void");
  });

  it("returns an empty layout rather than throwing on nothing to draw", () => {
    expect(layoutSankey([], { width: 600, height: 300 }).nodes).toEqual([]);
  });

  it("draws a closed ribbon between the two stacked bands", () => {
    const layout = layoutSankey(flows, { width: 600, height: 300 });
    const path = ribbonPath(layout.links[0]);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).toContain("C");
  });
});

describe("reading order", () => {
  it("puts what was earned above what was spent, in every column", () => {
    const layout = layoutSankey([
      { source: "revenue", target: "cost", value: 40 },
      { source: "revenue", target: "gross", value: 60 },
      { source: "gross", target: "opex", value: 25 },
      { source: "gross", target: "operating", value: 35 },
    ], { width: 600, height: 300, rank: (id) => (id === "cost" || id === "opex" ? 1 : 0) });
    const y = Object.fromEntries(layout.nodes.map((node) => [node.id, node.y]));
    expect(y.gross).toBeLessThan(y.cost);
    expect(y.operating).toBeLessThan(y.opex);
  });

  it("keeps declaration order between nodes of equal rank", () => {
    const layout = layoutSankey([
      { source: "revenue", target: "first", value: 10 },
      { source: "revenue", target: "second", value: 10 },
      { source: "revenue", target: "third", value: 10 },
    ], { width: 600, height: 300, rank: () => 0 });
    const order = layout.nodes.filter((node) => node.depth === 1).sort((a, b) => a.y - b.y).map((node) => node.id);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("draws a node nothing feeds just before what it feeds, not in the first column", () => {
    // "Other income" enters at pre-tax income, four stages along. Placed at
    // depth zero it sat beside revenue with a ribbon crossing the diagram.
    const layout = layoutSankey([
      { source: "revenue", target: "gross", value: 100 },
      { source: "gross", target: "operating", value: 80 },
      { source: "operating", target: "pretax", value: 80 },
      { source: "otherIncome", target: "pretax", value: 20 },
    ], { width: 600, height: 300 });
    const depth = Object.fromEntries(layout.nodes.map((node) => [node.id, node.depth]));
    expect(depth.pretax).toBe(3);
    expect(depth.otherIncome).toBe(2);
    expect(depth.revenue).toBe(0);
  });

  it("stacks ribbons in the order of the nodes at the other end, so they do not cross", () => {
    // "cost" is declared first but ranked below "gross", so the ribbon to gross
    // must leave revenue above the ribbon to cost.
    const layout = layoutSankey([
      { source: "revenue", target: "cost", value: 40 },
      { source: "revenue", target: "gross", value: 60 },
    ], { width: 600, height: 300, rank: (id) => (id === "cost" ? 1 : 0) });
    const toGross = layout.links.find((link) => link.target === "gross")!;
    const toCost = layout.links.find((link) => link.target === "cost")!;
    expect(toGross.sourceY).toBeLessThan(toCost.sourceY);
    expect(toGross.sourceY + toGross.thickness).toBeCloseTo(toCost.sourceY, 6);
  });
});

describe("income statement diagram", () => {
  const full = period({
    revenue: 1_000, costOfRevenue: 400, grossProfit: 600, operatingIncome: 300,
    researchAndDevelopment: 150, sellingGeneralAndAdministrative: 100,
    incomeTaxExpense: 60, netIncome: 240,
  });

  it("splits revenue into cost and gross profit, and they add back to revenue", () => {
    const diagram = incomeStatementDiagram(full)!;
    expect(sum(diagram.flows, "revenue", "source")).toBeCloseTo(1_000, 6);
  });

  it("names the operating costs the filer names and buckets the rest", () => {
    const diagram = incomeStatementDiagram(full)!;
    const ids = diagram.nodes.map((node) => node.id);
    expect(ids).toContain("researchAndDevelopment");
    expect(ids).toContain("sellingGeneralAndAdministrative");
    // Gross profit 600 less operating income 300 is 300 of costs; R&D and SG&A
    // account for 250, so 50 is left and must be shown rather than dropped.
    expect(diagram.values.otherOperating).toBeCloseTo(50, 6);
    expect(sum(diagram.flows, "grossProfit", "source")).toBeCloseTo(600, 6);
  });

  it("closes the gap below operating income instead of leaving it unexplained", () => {
    const diagram = incomeStatementDiagram(full)!;
    // 300 operating, 60 tax, 240 net: nothing non-operating, and the pre-tax
    // pool must balance exactly.
    expect(sum(diagram.flows, "pretax", "target")).toBeCloseTo(sum(diagram.flows, "pretax", "source"), 6);
  });

  it("enters non-operating income as its own source rather than netting it away", () => {
    const withIncome = period({ revenue: 1_000, costOfRevenue: 400, grossProfit: 600, operatingIncome: 300, incomeTaxExpense: 60, netIncome: 300 });
    const diagram = incomeStatementDiagram(withIncome)!;
    // Net 300 plus tax 60 is 360 against 300 of operating income: 60 came from
    // somewhere else, and the diagram must say so.
    expect(diagram.values.otherIncome).toBeCloseTo(60, 6);
    expect(diagram.flows.some((flow) => flow.source === "otherIncome" && flow.target === "pretax")).toBe(true);
  });

  it("shows a net non-operating cost as a cost", () => {
    const withCost = period({ revenue: 1_000, costOfRevenue: 400, grossProfit: 600, operatingIncome: 300, incomeTaxExpense: 40, netIncome: 200 });
    const diagram = incomeStatementDiagram(withCost)!;
    expect(diagram.values.otherCost).toBeCloseTo(60, 6);
  });

  it("stops honestly at gross profit when the company lost money", () => {
    const loss = period({ revenue: 1_000, costOfRevenue: 400, grossProfit: 600, operatingIncome: -50, netIncome: -80 });
    const diagram = incomeStatementDiagram(loss)!;
    expect(diagram.nodes.map((node) => node.id)).not.toContain("netIncome");
    expect(diagram.notes.join(" ")).toMatch(/Neither operating income nor net income is positive/);
  });

  it("still reaches net income when only operating income is negative", () => {
    // A year of operating losses offset by investment gains is a real shape,
    // and the profit that reached shareholders should still be drawn.
    const odd = period({ revenue: 1_000, costOfRevenue: 400, grossProfit: 600, operatingIncome: -50, incomeTaxExpense: 20, netIncome: 90 });
    const diagram = incomeStatementDiagram(odd)!;
    expect(diagram.values.pretax).toBeCloseTo(110, 6);
    expect(diagram.nodes.map((node) => node.id)).toContain("netIncome");
  });

  it("draws nothing at all without revenue", () => {
    expect(incomeStatementDiagram(period({ netIncome: 100 }))).toBeNull();
  });
});

describe("balance sheet diagram", () => {
  const sheet = period({
    totalAssets: 2_000, cashAndEquivalents: 300, shortTermInvestments: 100, accountsReceivable: 200,
    inventory: 100, propertyPlantAndEquipment: 500, goodwill: 300, intangibleAssets: 100,
    totalLiabilities: 1_200, accountsPayable: 400, totalDebt: 500, totalEquity: 800, retainedEarnings: 600,
  });

  it("draws the accounting identity: assets in, liabilities and equity out", () => {
    const diagram = balanceSheetDiagram(sheet)!;
    expect(sum(diagram.flows, "totalAssets", "target")).toBeCloseTo(2_000, 6);
    expect(sum(diagram.flows, "totalAssets", "source")).toBeCloseTo(2_000, 6);
  });

  it("buckets the assets the filer does not itemise", () => {
    const diagram = balanceSheetDiagram(sheet)!;
    // The named components come to 1,600 of a 2,000 total.
    expect(diagram.values.otherAssets).toBeCloseTo(400, 6);
  });

  it("takes liabilities as assets less equity when the filer reports no total", () => {
    const facts = { ...sheet.facts }; delete facts.totalLiabilities;
    const diagram = balanceSheetDiagram({ ...sheet, facts })!;
    expect(diagram.values.totalLiabilities).toBeCloseTo(1_200, 6);
    expect(diagram.notes.join(" ")).toMatch(/no total liabilities/);
  });

  it("refuses to split equity on a deficit, and says why", () => {
    const facts = { ...sheet.facts, retainedEarnings: { ...sheet.facts.retainedEarnings!, value: -14_264 } };
    const diagram = balanceSheetDiagram({ ...sheet, facts })!;
    expect(diagram.nodes.map((node) => node.id)).not.toContain("retainedEarnings");
    expect(diagram.notes.join(" ")).toMatch(/distributed more than it has ever earned/);
  });

  it("flags a breakdown that exceeds its own total instead of drawing a negative ribbon", () => {
    const facts = { ...sheet.facts, propertyPlantAndEquipment: { ...sheet.facts.propertyPlantAndEquipment!, value: 5_000 } };
    const diagram = balanceSheetDiagram({ ...sheet, facts })!;
    expect(diagram.notes.join(" ")).toMatch(/more than the reported total/);
    expect(diagram.flows.every((flow) => flow.value >= 0)).toBe(true);
    expect(sum(diagram.flows, "totalAssets", "target")).toBeCloseTo(2_000, 4);
  });

  it("draws nothing without a reported asset total", () => {
    expect(balanceSheetDiagram(period({ totalEquity: 100 }))).toBeNull();
  });
});

describe("balance sheet health", () => {
  const strong = period({
    currentAssets: 1_000, currentLiabilities: 500, cashAndEquivalents: 300, shortTermInvestments: 200,
    accountsReceivable: 200, inventory: 300, totalAssets: 2_000, totalEquity: 800, totalDebt: 400,
    goodwill: 300, intangibleAssets: 100, operatingIncome: 300, depreciationAndAmortization: 100,
    operatingCashFlow: 350, capitalExpenditures: 50, interestExpense: 20,
  });

  it("separates the current ratio from the quick ratio by excluding inventory", () => {
    const health = balanceSheetHealth(strong);
    const current = health.find((item) => item.key === "currentRatio")!;
    const quick = health.find((item) => item.key === "quickRatio")!;
    expect(current.value).toBeCloseTo(2, 6);
    expect(quick.value).toBeCloseTo(1.4, 6);
    expect(quick.value!).toBeLessThan(current.value!);
  });

  it("reports net cash as a negative leverage reading rather than hiding it", () => {
    const health = balanceSheetHealth(strong);
    // Debt 400 less cash 300 is 100 of net debt against 400 of EBITDA.
    expect(health.find((item) => item.key === "netDebtToEbitda")!.value).toBeCloseTo(.25, 6);
  });

  it("states how much of the asset base is the price of past acquisitions", () => {
    expect(balanceSheetHealth(strong).find((item) => item.key === "goodwillShare")!.value).toBeCloseTo(.2, 6);
  });

  it("gives a reason rather than a blank when a ratio cannot be formed", () => {
    const thin = period({ totalAssets: 1_000, totalEquity: 500 });
    const coverage = balanceSheetHealth(thin).find((item) => item.key === "interestCoverage")!;
    expect(coverage.value).toBeNull();
    expect(coverage.reason).toMatch(/no interest expense/);
  });
});

describe("filers that do not fit the standard shape", () => {
  it("reaches net income for a filer that tags no operating income at all", () => {
    // Zoetis: revenue and cost of sales, SG&A, tax and net income — but no
    // OperatingIncomeLoss. The diagram used to stop three boxes in.
    const zoetis = period({ revenue: 9_470, costOfRevenue: 2_670, sellingGeneralAndAdministrative: 2_380, incomeTaxExpense: 690, netIncome: 2_670 });
    const diagram = incomeStatementDiagram(zoetis)!;
    const ids = diagram.nodes.map((node) => node.id);
    expect(ids).toContain("netIncome");
    expect(ids).toContain("pretax");
    // Pre-tax income is net income plus the tax paid on it.
    expect(diagram.values.pretax).toBeCloseTo(3_360, 6);
    // Everything between gross profit and pre-tax has to be accounted for.
    expect(sum(diagram.flows, "grossProfit", "source")).toBeCloseTo(6_800, 6);
    expect(diagram.notes.join(" ")).toMatch(/tags no operating income/);
  });

  it("closes the claims side when minority partners own part of the group", () => {
    // Interactive Brokers: the listed company owns a quarter of the operating
    // group, so liabilities plus parent equity fall far short of total assets.
    const ibkr = period({ totalAssets: 203_240, totalLiabilities: 182_770, totalEquity: 5_360, cashAndEquivalents: 60_000 });
    const diagram = balanceSheetDiagram(ibkr)!;
    expect(diagram.values.otherClaims).toBeCloseTo(15_110, 6);
    expect(sum(diagram.flows, "totalAssets", "source")).toBeCloseTo(203_240, 6);
    expect(sum(diagram.flows, "totalAssets", "target")).toBeCloseTo(203_240, 6);
  });

  it("adds no minority slice when the balance sheet already closes", () => {
    const clean = period({ totalAssets: 1_000, totalLiabilities: 600, totalEquity: 400, cashAndEquivalents: 200 });
    expect(balanceSheetDiagram(clean)!.nodes.map((node) => node.id)).not.toContain("otherClaims");
  });

  it("still refuses to draw when neither profit measure is positive", () => {
    const losing = period({ revenue: 1_000, costOfRevenue: 400, grossProfit: 600, netIncome: -80 });
    const diagram = incomeStatementDiagram(losing)!;
    expect(diagram.nodes.map((node) => node.id)).not.toContain("pretax");
    expect(diagram.notes.join(" ")).toMatch(/Neither operating income nor net income is positive/);
  });
});

describe("a quarter must measure what its own year measures", () => {
  it("prefers the concept the annual figure uses when the filer tags both", () => {
    // Mastercard's shape: the year is tagged `Revenues` (net) while the
    // quarters also carry a contract-revenue concept holding the gross figure.
    // Taking the quarterly concept made 2021 sum to 26.7bn against a reported
    // 18.9bn, so every quarterly and trailing revenue was ~40% too high.
    const unit = (val: number, start: string | undefined, end: string, fp: string, tag: string) =>
      ({ start, end, val, accn: `${tag}-${end}`, fy: Number(end.slice(0, 4)), fp,
         form: fp === "FY" ? "10-K" : "10-Q", filed: `${Number(end.slice(0, 4)) + 1}-02-01` });

    const payload = { entityName: "Two Concept Co", facts: { "us-gaap": {
      Revenues: { units: { USD: [
        unit(4_155, "2021-01-01", "2021-03-31", "Q1", "net"),
        unit(8_683, "2021-01-01", "2021-06-30", "Q2", "net"),
        unit(13_668, "2021-01-01", "2021-09-30", "Q3", "net"),
        unit(18_884, "2021-01-01", "2021-12-31", "FY", "net"),
      ] } },
      RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
        unit(6_428, "2021-01-01", "2021-03-31", "Q1", "gross"),
        unit(13_647, "2021-01-01", "2021-06-30", "Q2", "gross"),
        unit(21_473, "2021-01-01", "2021-09-30", "Q3", "gross"),
      ] } },
    } } };

    const company = { name: "Two Concept Co", ticker: "TWO", cik: "0000000003", exchange: "NYSE", currency: "USD", sector: "Test", description: "A fixture." };
    const data = normalizeSecPayload(payload, "TWO", "2026-01-01", company);
    const quarters = data.periods.filter((item) => item.periodicity === "quarterly" && item.fiscalYear === 2021)
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    expect(quarters).toHaveLength(4);
    for (const quarter of quarters) expect(quarter.facts.revenue?.provenance.concept).toBe("us-gaap:Revenues");
    // And the whole point: they add back to the year.
    const total = quarters.reduce((sum, quarter) => sum + (quarter.facts.revenue?.value ?? 0), 0);
    expect(total).toBeCloseTo(18_884, 6);
  });
});

describe("cash flow diagram", () => {
  const full = period({
    netIncome: 240, operatingCashFlow: 300, capitalExpenditures: 60,
    depreciationAndAmortization: 35, stockBasedCompensation: 20,
    dividendsPaid: 90, shareRepurchases: 100,
  });

  it("balances profit plus the add-backs against operating cash flow", () => {
    const diagram = cashFlowDiagram(full)!;
    expect(sum(diagram.flows, "operatingCashFlow", "target")).toBeCloseTo(300, 6);
  });

  it("splits operating cash flow into capex and free cash flow", () => {
    const diagram = cashFlowDiagram(full)!;
    expect(sum(diagram.flows, "operatingCashFlow", "source")).toBeCloseTo(300, 6);
    expect(diagram.values.freeCashFlow).toBeCloseTo(240, 6);
    expect(diagram.values.capitalExpenditures).toBeCloseTo(60, 6);
  });

  it("shows where the free cash flow went, and keeps the remainder", () => {
    const diagram = cashFlowDiagram(full)!;
    expect(sum(diagram.flows, "freeCashFlow", "source")).toBeCloseTo(240, 6);
    expect(diagram.values.dividendsPaid).toBeCloseTo(90, 6);
    expect(diagram.values.shareRepurchases).toBeCloseTo(100, 6);
    expect(diagram.values.retainedCash).toBeCloseTo(50, 6);
  });

  it("draws the bridge as one line when the add-backs exceed it, and says why", () => {
    // D&A and SBC add to 55 against a bridge of 20: working capital took the
    // difference, and naming them separately would need an outflow the filing
    // does not itemise.
    const tight = period({ netIncome: 280, operatingCashFlow: 300, capitalExpenditures: 60, depreciationAndAmortization: 35, stockBasedCompensation: 20 });
    const diagram = cashFlowDiagram(tight)!;
    expect(diagram.nodes.map((node) => node.id)).toContain("nonCashAndWorkingCapital");
    expect(diagram.nodes.map((node) => node.id)).not.toContain("depreciationAndAmortization");
    expect(diagram.values.nonCashAndWorkingCapital).toBeCloseTo(20, 6);
    expect(diagram.notes.join(" ")).toContain("working capital consumed the difference");
    expect(sum(diagram.flows, "operatingCashFlow", "target")).toBeCloseTo(300, 6);
  });

  it("draws profit that did not become cash as an outflow", () => {
    const draining = period({ netIncome: 300, operatingCashFlow: 200, capitalExpenditures: 40 });
    const diagram = cashFlowDiagram(draining)!;
    expect(diagram.values.cashConsumed).toBeCloseTo(100, 6);
    expect(sum(diagram.flows, "netIncome", "source")).toBeCloseTo(300, 6);
  });

  it("scales returns that exceeded the year's cash, and states the multiple", () => {
    const generous = period({ netIncome: 100, operatingCashFlow: 120, capitalExpenditures: 20, dividendsPaid: 60, shareRepurchases: 140 });
    const diagram = cashFlowDiagram(generous)!;
    // 200 returned against 100 of free cash flow: drawn to 100, reported at 200.
    expect(sum(diagram.flows, "freeCashFlow", "source")).toBeCloseTo(100, 6);
    expect(diagram.values.shareRepurchases).toBeCloseTo(140, 6);
    expect(diagram.notes.join(" ")).toContain("2.00×");
    expect(diagram.nodes.map((node) => node.id)).not.toContain("retainedCash");
  });

  it("stops at operating cash flow when the filer tags no capex", () => {
    const diagram = cashFlowDiagram(period({ netIncome: 100, operatingCashFlow: 120 }))!;
    expect(diagram.nodes.map((node) => node.id)).not.toContain("freeCashFlow");
    expect(diagram.notes.join(" ")).toContain("no capital expenditure");
  });

  it("says so rather than drawing a negative ribbon when capex exceeded the cash", () => {
    const heavy = period({ netIncome: 40, operatingCashFlow: 100, capitalExpenditures: 160 });
    const diagram = cashFlowDiagram(heavy)!;
    expect(diagram.nodes.map((node) => node.id)).not.toContain("freeCashFlow");
    expect(sum(diagram.flows, "operatingCashFlow", "source")).toBeCloseTo(100, 6);
    expect(diagram.notes.join(" ")).toContain("exceeded operating cash flow");
  });

  it("returns nothing without a reported operating cash flow", () => {
    expect(cashFlowDiagram(period({ netIncome: 100 }))).toBeNull();
  });
});
