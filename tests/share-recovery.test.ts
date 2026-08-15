import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { derivedValue, valueOf } from "../lib/finance";
import type { CompanyDataset } from "../lib/types";

const company = { name: "Multi Class Co", ticker: "MULTI", cik: "0000000002", exchange: "NYSE", currency: "USD", sector: "Test", description: "A fixture." };

type Unit = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
const flow = (val: number, start: string, end: string, fp: string, form = fp === "FY" ? "10-K" : "10-Q"): Unit =>
  ({ start, end, val, accn: `a-${end}-${fp}`, fy: Number(end.slice(0, 4)), fp, form, filed: `${Number(end.slice(0, 4)) + 1}-01-15` });
const point = (val: number, end: string): Unit =>
  ({ end, val, accn: `p-${end}`, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed: `${Number(end.slice(0, 4)) + 1}-01-15` });

/** Four quarters and a year of one fiscal year, for any duration-based tag. */
function year(y: number, quarterly: number[], annual: number) {
  const q = [
    flow(quarterly[0], `${y}-01-01`, `${y}-03-31`, "Q1"),
    flow(quarterly[1], `${y}-01-01`, `${y}-06-30`, "Q2"),
    flow(quarterly[2], `${y}-01-01`, `${y}-09-30`, "Q3"),
  ];
  return [...q, flow(annual, `${y}-01-01`, `${y}-12-31`, "FY")];
}

/** The same, where every context carries one quarter's rate — Visa's habit. */
function rateYear(y: number, rate: number) {
  return [
    flow(rate, `${y}-01-01`, `${y}-03-31`, "Q1"),
    flow(rate, `${y}-04-01`, `${y}-06-30`, "Q2"),
    flow(rate, `${y}-07-01`, `${y}-09-30`, "Q3"),
    flow(rate, `${y}-01-01`, `${y}-12-31`, "FY"),
  ];
}

function payload(tags: Record<string, Unit[]>) {
  return { entityName: "Multi Class Co", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, units]) => {
    const perShare = tag.includes("PerShare") || tag.includes("EarningsPerShare");
    const shares = tag.includes("WeightedAverage");
    return [tag, { units: { [perShare ? "USD/shares" : shares ? "shares" : "USD"]: units } }];
  })) } };
}

const build = (tags: Record<string, Unit[]>): CompanyDataset => normalizeSecPayload(payload(tags), "MULTI", "2026-01-01", company);
const annualOf = (data: CompanyDataset, y: number) => data.periods.find((p) => p.periodicity === "annual" && p.fiscalYear === y)!;

const CASH = [2020, 2021].flatMap((y) => year(y, [100, 200, 300], 400));
const CAPEX = [2020, 2021].flatMap((y) => year(y, [10, 20, 30], 40));
const REVENUE = [2020, 2021].flatMap((y) => year(y, [250, 500, 750], 1_000));
const DIVIDENDS_PAID = [2020, 2021].flatMap((y) => year(y, [40, 80, 120], 160));

describe("dividends per share tagged as a rate", () => {
  it("rebuilds the year from its quarters when every context carries one rate", () => {
    const data = build({
      Revenues: REVENUE, NetCashProvidedByUsedInOperatingActivities: CASH,
      PaymentsToAcquirePropertyPlantAndEquipment: CAPEX, PaymentsOfDividends: DIVIDENDS_PAID,
      CommonStockDividendsPerShareDeclared: [2020, 2021].flatMap((y) => rateYear(y, 0.05)),
    });
    // Four quarters at 0.05 is 0.20 for the year, not the 0.05 that was tagged.
    expect(valueOf(annualOf(data, 2021), "dividendsPerShare")).toBeCloseTo(.2, 10);
    expect(annualOf(data, 2021).facts.dividendsPerShare?.provenance.status).toBe("calculated");
  });

  it("leaves a filer that tags cumulatively completely alone", () => {
    const data = build({
      Revenues: REVENUE, NetCashProvidedByUsedInOperatingActivities: CASH,
      PaymentsToAcquirePropertyPlantAndEquipment: CAPEX, PaymentsOfDividends: DIVIDENDS_PAID,
      // Year to date: 0.05, 0.10, 0.15, 0.20 — the annual figure is the total.
      CommonStockDividendsPerShareDeclared: [2020, 2021].flatMap((y) => year(y, [.05, .1, .15], .2)),
    });
    expect(valueOf(annualOf(data, 2021), "dividendsPerShare")).toBeCloseTo(.2, 10);
    expect(annualOf(data, 2021).facts.dividendsPerShare?.provenance.status).toBe("reported");
  });
});

describe("share count recovered from the dividend", () => {
  const base = {
    Revenues: REVENUE, NetCashProvidedByUsedInOperatingActivities: CASH,
    PaymentsToAcquirePropertyPlantAndEquipment: CAPEX, PaymentsOfDividends: DIVIDENDS_PAID,
  };

  it("divides the dividend paid by the dividend per share", () => {
    const data = build({ ...base, CommonStockDividendsPerShareDeclared: [2020, 2021].flatMap((y) => rateYear(y, 0.05)) });
    const period = annualOf(data, 2021);
    // 160 of dividends over a 0.20 annual rate is 800 shares.
    expect(valueOf(period, "dilutedShares")).toBeCloseTo(800, 6);
    expect(period.facts.dilutedShares?.provenance.concept).toBe("SharesFromDividendsPaid");
    expect(period.facts.dilutedShares?.provenance.formula).toBe("Dividends paid / Dividends per share");
    // Which is the whole point: every per-share metric becomes available.
    expect(derivedValue(period, "freeCashFlowPerShare")).toBeCloseTo((400 - 40) / 800, 10);
  });

  it("never displaces a share count the filer reported", () => {
    const data = build({
      ...base, CommonStockDividendsPerShareDeclared: [2020, 2021].flatMap((y) => rateYear(y, 0.05)),
      WeightedAverageNumberOfDilutedSharesOutstanding: [2020, 2021].flatMap((y) => year(y, [1_000, 1_000, 1_000], 1_000)),
    });
    const period = annualOf(data, 2021);
    expect(valueOf(period, "dilutedShares")).toBe(1_000);
    expect(period.facts.dilutedShares?.provenance.status).toBe("reported");
  });

  it("yields to the earnings recovery, which is exact", () => {
    const data = build({
      ...base, CommonStockDividendsPerShareDeclared: [2020, 2021].flatMap((y) => rateYear(y, 0.05)),
      NetIncomeLoss: [2020, 2021].flatMap((y) => year(y, [50, 100, 150], 200)),
      EarningsPerShareDiluted: [2020, 2021].flatMap((y) => year(y, [.05, .1, .15], .2)),
    });
    const period = annualOf(data, 2021);
    // 200 of net income over 0.20 of EPS is 1,000 shares, not the 800 the
    // dividend implies — and earnings are the definition, so they win.
    expect(valueOf(period, "dilutedShares")).toBeCloseTo(1_000, 6);
    expect(period.facts.dilutedShares?.provenance.concept).toBe("DilutedSharesFromEps");
  });

  it("refuses a year whose rate was never proven, rather than reporting four times the shares", () => {
    const data = build({
      Revenues: [2020, 2021, 2022].flatMap((y) => year(y, [250, 500, 750], 1_000)),
      NetCashProvidedByUsedInOperatingActivities: [2020, 2021, 2022].flatMap((y) => year(y, [100, 200, 300], 400)),
      PaymentsToAcquirePropertyPlantAndEquipment: [2020, 2021, 2022].flatMap((y) => year(y, [10, 20, 30], 40)),
      PaymentsOfDividends: [2020, 2021, 2022].flatMap((y) => year(y, [40, 80, 120], 160)),
      CommonStockDividendsPerShareDeclared: [
        // 2021 has its four quarters and proves the habit; 2022 has only the
        // annual context, so its rate cannot be turned into a year.
        ...rateYear(2021, 0.05),
        flow(0.05, "2022-01-01", "2022-12-31", "FY"),
      ],
    });
    expect(valueOf(annualOf(data, 2021), "dilutedShares")).toBeCloseTo(800, 6);
    expect(valueOf(annualOf(data, 2022), "dilutedShares")).toBeNull();
    // The reported tag is left exactly as filed — one ambiguous year must not
    // delete a figure the company actually published.
    expect(valueOf(annualOf(data, 2022), "dividendsPerShare")).toBeCloseTo(.05, 10);
  });

  it("does nothing for a company that pays no dividend", () => {
    const data = build({ ...base, PaymentsOfDividends: [] });
    expect(valueOf(annualOf(data, 2021), "dilutedShares")).toBeNull();
  });
});

describe("the balance sheet is untouched by any of this", () => {
  it("keeps a reported total debt as reported", () => {
    const data = build({
      Revenues: REVENUE, NetCashProvidedByUsedInOperatingActivities: CASH,
      LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent: [point(5_000, "2021-12-31")],
    });
    expect(valueOf(annualOf(data, 2021), "totalDebt")).toBe(5_000);
  });
});
