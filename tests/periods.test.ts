import { describe, expect, it } from "vitest";
import { adjustPeriodsForSplits, buildTtmPeriods, dedupeFacts, normalizeAnnualPeriods, normalizeQuarterlyPeriods, normalizeShareUnitScales, relabelFiscalYears } from "../lib/periods";
import { normalizeSecPayload } from "../lib/adapters/sec";
import type { MetricKey, RawFinancialFact } from "../lib/types";

function raw(metric: MetricKey, value: number, start: string | undefined, end: string, fiscalPeriod: RawFinancialFact["fiscalPeriod"], fiscalYear = 2025, filed = "2025-11-01"): RawFinancialFact {
  return { metric, value, start, end, fiscalPeriod, fiscalYear, filed, accession: `acc-${fiscalPeriod}-${filed}`, form: fiscalPeriod === "FY" ? "10-K" : "10-Q", concept: `us-gaap:${metric}`, currency: "USD", unit: metric.includes("Shares") || ["basicShares", "dilutedShares", "sharesOutstanding"].includes(metric) ? "shares" : "currency", sourceUrl: "https://sec.test/filing", retrievedAt: "2026-08-13" };
}

function standardYear(start = "2025-01-01", fiscalYear = 2025) {
  const dates = [
    [start, "2025-03-31", "Q1", 10],
    [start, "2025-06-30", "Q2", 25],
    [start, "2025-09-30", "Q3", 45],
    [start, "2025-12-31", "FY", 70],
  ] as const;
  const facts: RawFinancialFact[] = [];
  for (const metric of ["revenue", "operatingCashFlow", "capitalExpenditures"] as MetricKey[]) {
    for (const [periodStart, end, fp, value] of dates) facts.push(raw(metric, metric === "capitalExpenditures" ? value / 5 : value, periodStart, end, fp, fiscalYear));
  }
  for (const [quarterStart, end, fp, shares] of [
    ["2025-01-01", "2025-03-31", "Q1", 100], ["2025-04-01", "2025-06-30", "Q2", 101],
    ["2025-07-01", "2025-09-30", "Q3", 102], ["2025-01-01", "2025-12-31", "FY", 101.5],
  ] as const) facts.push(raw("dilutedShares", shares, quarterStart, end, fp, fiscalYear));
  return facts;
}

describe("quarterly SEC normalization", () => {
  it("relabels comparative SEC facts from actual fiscal ends instead of the filing fy",()=>{const old=raw("revenue",100,"2013-08-01","2014-07-31","FY",2016,"2016-09-01");expect(relabelFiscalYears([old])[0].fiscalYear).toBe(2014);expect(normalizeAnnualPeriods([old],"USD")[0].fiscalYear).toBe(2014)});
  it("resolves thousand-versus-unit source conflicts by corroborated magnitude",()=>{const facts=[raw("dilutedShares",131_230,"2013-08-01","2014-07-31","FY",2014,"2014-09-01"),raw("dilutedShares",131_230_000,"2013-08-01","2014-07-31","FY",2015,"2015-09-01"),raw("dilutedShares",131_230_000,"2013-08-01","2014-07-31","FY",2016,"2016-09-01")];const selected=dedupeFacts(relabelFiscalYears(facts))[0];expect(selected.value).toBe(131_230_000);expect(selected.sourceConflictValues).toContain(131_230)});
  it("detects a one-million share-unit mismatch without deleting the raw value",()=>{const tiny=raw("dilutedShares",100,"2023-01-01","2023-12-31","FY",2023);const normal=raw("dilutedShares",100_000_000,"2024-01-01","2024-12-31","FY",2024);const normalized=normalizeShareUnitScales([tiny,normal]);expect(normalized[0].value).toBe(100_000_000);expect(normalized[0].sourceConflictValues).toContain(100)});
  it("isolates cumulative cash-flow and annual Q4 facts without dividing by four", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    expect(quarters.map((period) => period.facts.operatingCashFlow?.value)).toEqual([10, 15, 20, 25]);
    expect(quarters[1].facts.operatingCashFlow?.provenance.status).toBe("calculated");
    expect(quarters[1].facts.operatingCashFlow?.provenance.formula).toContain("cumulative through Q2");
    expect(quarters[3].fiscalQuarter).toBe("Q4");
  });

  it("selects the latest restated value for a duplicated context", () => {
    const facts = standardYear();
    facts.push(raw("revenue", 11, "2025-01-01", "2025-03-31", "Q1", 2025, "2025-11-15"));
    const quarter = normalizeQuarterlyPeriods(facts, "USD")[0];
    expect(quarter.facts.revenue?.value).toBe(11);
    expect(quarter.facts.revenue?.provenance.status).toBe("restated");
  });

  it("supports shifted fiscal years by using actual context dates", () => {
    const facts = standardYear("2024-10-01", 2025).map((fact) => {
      const ends = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"];
      const position = ["Q1", "Q2", "Q3", "FY"].indexOf(fact.fiscalPeriod);
      return { ...fact, start: fact.fiscalPeriod === "Q1" || fact.start === "2025-01-01" ? "2024-10-01" : fact.start, end: ends[position] ?? fact.end };
    });
    const quarters = normalizeQuarterlyPeriods(facts, "USD");
    expect(quarters.at(-1)?.periodEnd).toBe("2025-09-30");
    expect(quarters.at(-1)?.fiscalYear).toBe(2025);
  });
});

describe("TTM construction", () => {
  it("sums four consecutive quarters and day-weights diluted shares", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    const ttm = buildTtmPeriods(quarters, "USD");
    expect(ttm).toHaveLength(1);
    expect(ttm[0].facts.revenue?.value).toBe(70);
    expect(ttm[0].ttmQuarterEnds).toEqual(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
    expect(ttm[0].facts.dilutedShares?.value).toBeGreaterThan(101);
  });

  it("accepts a 53-week fiscal year", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    quarters[3].periodEnd = "2026-01-07";
    quarters[3].facts.revenue!.periodEnd = "2026-01-07";
    quarters[3].durationDays = 99;
    expect(buildTtmPeriods(quarters, "USD")).toHaveLength(1);
  });

  it("rejects a missing quarter, overlaps and insufficient data", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    expect(buildTtmPeriods(quarters.slice(0, 3), "USD")).toHaveLength(0);
    expect(buildTtmPeriods([quarters[0], quarters[1], quarters[1], quarters[3]], "USD")).toHaveLength(0);
    expect(buildTtmPeriods([quarters[0], quarters[1], quarters[3]], "USD")).toHaveLength(0);
  });

  it("rejects a window when a fiscal-year change creates a gap", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear(), "USD");
    quarters[2].periodStart = "2025-08-01";
    expect(buildTtmPeriods(quarters, "USD")).toHaveLength(0);
  });

  it("makes historical share counts comparable across subsequent stock splits", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear().map((fact)=>({...fact,filed:"2026-01-01"})), "USD");
    const adjusted = adjustPeriodsForSplits(quarters, [{ date: "2026-01-15", ratio: 4 }]);
    expect(adjusted[0].facts.dilutedShares?.value).toBe(400);
    expect(adjusted[0].facts.dilutedShares?.provenance.formula).toContain("4:1");
  });

  it("never split-adjusts currency facts and does not double-adjust later restatements", () => {
    const quarters = normalizeQuarterlyPeriods(standardYear().map((fact)=>({...fact,filed:"2026-02-01"})), "USD");
    quarters[0].facts.cashAndEquivalents = { ...quarters[0].facts.revenue!, metric:"cashAndEquivalents", value:50, unit:"currency" };
    const adjusted = adjustPeriodsForSplits(quarters, [{ date:"2026-01-15", ratio:4 }]);
    expect(adjusted[0].facts.cashAndEquivalents?.value).toBe(50);
    expect(adjusted[0].facts.dilutedShares?.value).toBe(100);
  });
});

describe("a year restated under a new concept keeps its quarters", () => {
  // Adopting the revenue standard in 2018, filers restated the prior year with
  // a new concept and left that year's quarters under the old one. Insisting on
  // the year's own concept lost the quarters, and with them every trailing
  // window that touched them: seventeen of the twenty-one companies in the
  // watchlist, Apple by two whole years.
  const withConcept = (fact: RawFinancialFact, concept: string): RawFinancialFact => ({ ...fact, concept });
  const oldTag = "us-gaap:SalesRevenueNet";
  const newTag = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";

  const quarters = [
    withConcept(raw("revenue", 10, "2025-01-01", "2025-03-31", "Q1"), oldTag),
    withConcept(raw("revenue", 25, "2025-01-01", "2025-06-30", "Q2"), oldTag),
    withConcept(raw("revenue", 45, "2025-01-01", "2025-09-30", "Q3"), oldTag),
  ];

  it("uses the old concept when the restated year is the same number", () => {
    const facts = [
      ...quarters,
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY"), oldTag),
      // Filed later, so it wins the annual — same total, new tag.
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY", 2025, "2027-11-01"), newTag),
    ];
    const periods = normalizeQuarterlyPeriods(facts, "USD");
    expect(periods.map((period) => period.fiscalQuarter)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(periods.reduce((total, period) => total + (period.facts.revenue?.value ?? 0), 0)).toBeCloseTo(70, 6);
  });

  it("keeps exact originally reported quarters when an ASC 606 restatement publishes no quarterly allocation", () => {
    // The quarterly series is explicitly the earlier reported basis; the
    // annual series remains the later restated 90. Nothing is allocated.
    const facts = [
      ...quarters,
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY"), oldTag),
      withConcept(raw("revenue", 90, "2025-01-01", "2025-12-31", "FY", 2025, "2027-11-01"), newTag),
    ];
    const periods = normalizeQuarterlyPeriods(facts, "USD");
    expect(periods.map((period) => period.facts.revenue?.value)).toEqual([10, 15, 20, 25]);
    expect(periods[0].facts.revenue?.provenance.note).toContain("no value is estimated");
    expect(normalizeAnnualPeriods(facts, "USD")[0].facts.revenue?.value).toBe(90);
  });

  it("still refuses to mix two concepts that are not the same measure", () => {
    // The Mastercard case: quarters tagged gross against a net year, eight
    // billion apart. Nothing here may bring those back together.
    const facts = [
      withConcept(raw("revenue", 30, "2025-01-01", "2025-03-31", "Q1"), "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax"),
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY"), "us-gaap:Revenues"),
    ];
    const periods = normalizeQuarterlyPeriods(facts, "USD");
    expect(periods.find((period) => period.fiscalQuarter === "Q1")).toBeUndefined();
  });

  it("builds all four quarters from one concept, never two", () => {
    const facts = [
      ...quarters,
      // A stray new-tag quarter must not be picked up beside three old-tag ones.
      withConcept(raw("revenue", 12, "2025-01-01", "2025-03-31", "Q1", 2025, "2027-11-01"), newTag),
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY"), oldTag),
      withConcept(raw("revenue", 70, "2025-01-01", "2025-12-31", "FY", 2025, "2027-11-01"), newTag),
    ];
    const periods = normalizeQuarterlyPeriods(facts, "USD");
    const concepts = new Set(periods.map((period) => period.facts.revenue?.provenance.concept));
    expect(concepts.size).toBe(1);
    expect(periods.reduce((total, period) => total + (period.facts.revenue?.value ?? 0), 0)).toBeCloseTo(70, 6);
  });
});

describe("a quarter published as a comparative in a later annual report", () => {
  /**
   * The Microsoft shape, in miniature.
   *
   * A June-year filer restates a year under a new concept and republishes that
   * year's four quarters inside the annual report that restated it. Every one
   * of those comparatives inherits the filing's own `fp: "FY"`.
   */
  const fact = (concept: string, start: string, end: string, val: number, fp: string, form: string, filed: string) =>
    ({ start, end, val, accn: `a-${filed}`, fy: 2018, fp, form, filed });

  const payload = {
    entityName: "Comparative Corp",
    facts: {
      "us-gaap": {
        // The old basis: FY2017 as originally filed, with its own quarters.
        SalesRevenueNet: { units: { USD: [
          fact("SalesRevenueNet", "2016-07-01", "2017-06-30", 90_000, "FY", "10-K", "2017-08-02"),
          fact("SalesRevenueNet", "2016-07-01", "2016-09-30", 20_500, "Q1", "10-Q", "2016-10-20"),
          fact("SalesRevenueNet", "2016-10-01", "2016-12-31", 24_100, "Q2", "10-Q", "2017-01-26"),
          fact("SalesRevenueNet", "2017-01-01", "2017-03-31", 22_100, "Q3", "10-Q", "2017-04-27"),
        ] } },
        // The new basis: the restated year and its four quarters, all carrying
        // the annual report's `fp: "FY"`.
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
          fact("x", "2016-07-01", "2017-06-30", 96_600, "FY", "10-K", "2018-08-03"),
          fact("x", "2016-07-01", "2016-09-30", 21_900, "FY", "10-K", "2018-08-03"),
          fact("x", "2016-10-01", "2016-12-31", 25_800, "FY", "10-K", "2018-08-03"),
          fact("x", "2017-01-01", "2017-03-31", 23_200, "FY", "10-K", "2018-08-03"),
          fact("x", "2017-04-01", "2017-06-30", 25_700, "FY", "10-K", "2018-08-03"),
        ] } },
      },
    },
  };
  const profile = { name: "Comparative Corp", ticker: "CMP", cik: "0000000001", exchange: "NASDAQ", currency: "USD", sector: "x", description: "x" };

  it("recovers the restated quarters, and they sum to the restated year", () => {
    /*
     * Microsoft adopted the revenue standard in fiscal 2018 and restated 2017
     * with it. Its 2018 annual report carries fiscal 2017's four quarters
     * under the restated concept — 21.9, 25.8, 23.2 and 25.6 billion, summing
     * to the 96.6 the year is now stated at — but every one carries the
     * filing's own `fp: "FY"`, so nothing looking in the quarterly contexts
     * ever saw them and two years vanished from every quarterly and trailing
     * view.
     */
    const dataset = normalizeSecPayload(payload, "CMP", "2026-08-30T00:00:00.000Z", profile);
    const quarters = dataset.periods
      .filter((period) => period.periodicity === "quarterly" && period.periodEnd > "2016-06-30" && period.periodEnd <= "2017-06-30")
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    expect(quarters.map((period) => period.periodEnd)).toEqual(["2016-09-30", "2016-12-31", "2017-03-31", "2017-06-30"]);
    expect(quarters.map((period) => period.facts.revenue?.value)).toEqual([21_900, 25_800, 23_200, 25_700]);

    // The point of the whole exercise: the four add up to the year.
    const year = dataset.periods.find((period) => period.periodicity === "annual" && period.periodEnd === "2017-06-30");
    expect(year?.facts.revenue?.value).toBe(96_600);
    expect(quarters.reduce((sum, period) => sum + (period.facts.revenue?.value ?? 0), 0)).toBe(96_600);
  });

  it("reads annual-form comparatives labelled Q4 like FY contexts", () => {
    const q4Fact = (start: string, end: string, val: number) =>
      ({ start, end, val, accn: `q4-${end}`, fy: 2019, fp: "Q4", form: "10-K", filed: "2019-02-13" });
    const q4Payload = { entityName: "Q4 Context Corp", facts: { "us-gaap": { Revenues: { units: { USD: [
      q4Fact("2017-01-01", "2017-03-31", 10),
      q4Fact("2017-04-01", "2017-06-30", 20),
      q4Fact("2017-07-01", "2017-09-30", 30),
      q4Fact("2017-10-01", "2017-12-31", 40),
      q4Fact("2017-01-01", "2017-12-31", 100),
    ] } } } } };
    const q4Profile = { name: "Q4 Context Corp", ticker: "Q4C", cik: "0000000004", exchange: "NYSE", currency: "USD", sector: "Test", description: "A fixture." };
    const dataset = normalizeSecPayload(q4Payload, "Q4C", "2026-09-01", q4Profile);
    const revenue = dataset.periods.filter((period) => period.periodicity === "quarterly" && period.fiscalYear === 2017)
      .map((period) => period.facts.revenue?.value);
    expect(revenue).toEqual([10, 20, 30, 40]);
  });

  it("takes the restated quarters over the ones filed on the old basis", () => {
    // Both are in the filings. Publishing 20.5 under a year of 96.6 would give
    // four quarters that add up to a year the company no longer reports.
    const dataset = normalizeSecPayload(payload, "CMP", "2026-08-30T00:00:00.000Z", profile);
    const first = dataset.periods.find((period) => period.periodicity === "quarterly" && period.periodEnd === "2016-09-30");
    expect(first?.facts.revenue?.value).toBe(21_900);
    expect(first?.facts.revenue?.value).not.toBe(20_500);
  });

  it("dates a comparative quarter by the year it belongs to, not by its end", () => {
    // September 2016 is the first quarter of a June filer's fiscal 2017.
    // Dating it by the calendar year of its end put it two quarters away.
    const dataset = normalizeSecPayload(payload, "CMP", "2026-08-30T00:00:00.000Z", profile);
    const first = dataset.periods.find((period) => period.periodicity === "quarterly" && period.periodEnd === "2016-09-30");
    expect(first?.fiscalYear).toBe(2017);
    expect(first?.fiscalQuarter).toBe("Q1");
  });
});
