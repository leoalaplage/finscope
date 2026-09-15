import { describe, expect, it } from "vitest";
import { auditCompany, compareWithFrames, framesNeeded, summariseAudits, type AuditReport, type CompanyAudit } from "../lib/coverage-audit";
import type { IoCompanyView, IoPeriod } from "../lib/io/view";

const period = (label: string, end: string, values: Record<string, number | null>): IoPeriod =>
  ({ label, end, filingDate: end, values } as unknown as IoPeriod);

const full = { revenue: 100, netIncome: 10, operatingCashFlow: 20, capitalExpenditures: 5, freeCashFlow: 15, dilutedShares: 50 };

const view = (businessType: string | null, ttmValues: Record<string, number | null>, trailing: Array<Record<string, number | null>> = []): IoCompanyView => {
  const ttm = period("TTM Q2 FY2026", "2026-06-30", ttmValues);
  return {
    company: { ticker: "TEST", name: "Test", businessType },
    annual: [period("FY 2025", "2025-12-31", full)],
    trailing: [...trailing.map((values, index) => period(`TTM ${index}`, `2025-0${index + 1}-28`, values)), ttm],
    ttm,
  } as unknown as IoCompanyView;
};

describe("a company's own check", () => {
  it("flags a missing free cash flow on an operating company", () => {
    const audit = auditCompany(view("operating", { ...full, capitalExpenditures: null, freeCashFlow: null }), null);
    expect(audit.missingTtm).toEqual(["capitalExpenditures", "freeCashFlow"]);
    expect(audit.missingAnnual).toEqual([]);
    expect(audit.recentTtmWithoutFcf).toBe(1);
  });

  it("does not call a measure withheld by design a hole", () => {
    const audit = auditCompany(view("bank", { ...full, freeCashFlow: null }), null);
    expect(audit.missingTtm).toEqual([]);
    expect(audit.recentTtmWithoutFcf).toBe(0);
  });

  it("notices a figure that moves on the same period, and not one that moves with a new period", () => {
    const first = auditCompany(view("operating", full), null);
    const same = auditCompany(view("operating", { ...full, freeCashFlow: 30 }), first);
    expect(same.moved).toEqual([{ measure: "freeCashFlow", period: "TTM Q2 FY2026", from: 15, to: 30 }]);
    const later: CompanyAudit = { ...first, ttm: { label: "TTM Q1 FY2026", end: "2026-03-31", filed: "2026-05-01" } };
    expect(auditCompany(view("operating", { ...full, freeCashFlow: 30 }), later).moved).toEqual([]);
  });
});

describe("the day's report", () => {
  const audit = (ticker: string, heldEnd: string, missingTtm: string[] = []): CompanyAudit => ({
    ticker, name: ticker, businessType: "operating", checkedAt: "2026-09-14T00:00:00Z",
    annual: { label: "FY 2025", end: "2025-12-31", filed: "2026-02-01" },
    ttm: { label: "TTM", end: heldEnd, filed: heldEnd },
    missingAnnual: [], missingTtm, recentTtmWithoutFcf: missingTtm.includes("freeCashFlow") ? 1 : 0, values: {}, moved: [],
  });
  const now = new Date("2026-09-14T12:00:00Z");

  it("counts holes, companies behind their filings, and companies not yet checked", () => {
    const audits = new Map([
      ["AAA", audit("AAA", "2026-06-30", ["freeCashFlow"])],
      ["BBB", audit("BBB", "2026-03-31")],
      ["CCC", audit("CCC", "2026-06-30")],
    ]);
    const filings = new Map([
      // Filed a later quarter ten days ago: behind.
      ["BBB", { form: "10-Q", filingDate: "2026-09-04", reportDate: "2026-06-30" }],
      // Filed yesterday: inside the grace the SEC's own feed needs.
      ["CCC", { form: "10-Q", filingDate: "2026-09-13", reportDate: "2026-09-30" }],
    ]);
    const report = summariseAudits([{ ticker: "AAA" }, { ticker: "BBB" }, { ticker: "CCC" }, { ticker: "DDD" }], audits, filings, null, now);
    expect(report.totals.missingFcfLatest).toBe(1);
    expect(report.issues.stale.map((entry) => entry.ticker)).toEqual(["BBB"]);
    expect(report.issues.notBuilt).toEqual(["DDD"]);
    expect(report.previousTotals).toBeNull();
  });

  it("says what got worse since the previous day", () => {
    const yesterday = summariseAudits([{ ticker: "AAA" }], new Map([["AAA", audit("AAA", "2026-06-30")]]), new Map(), null, new Date("2026-09-13T12:00:00Z"));
    const today = summariseAudits([{ ticker: "AAA" }], new Map([["AAA", audit("AAA", "2026-06-30", ["freeCashFlow"])]]), new Map(), yesterday as AuditReport, now);
    expect(today.regressions).toContain("missingFcfLatest");
    expect(today.history.map((entry) => entry.date)).toEqual(["2026-09-13", "2026-09-14"]);
  });
});

describe("the latest year against the SEC's own frames", () => {
  const checked = (ticker: string, cik: string, figures: Array<Partial<import("../lib/coverage-audit").SourcedFigure>>): CompanyAudit => ({
    ticker, cik, name: ticker, businessType: "operating", checkedAt: "2026-09-15T00:00:00Z", annual: null, ttm: null,
    missingAnnual: [], missingTtm: [], recentTtmWithoutFcf: 0, values: {}, moved: [],
    sourced: figures.map((figure) => ({ measure: "revenue", label: "FY 2025", start: "2025-01-01", end: "2025-12-31", value: 0, concept: "us-gaap:Revenues", accession: null, ...figure })),
  });

  it("asks for the calendar year a fiscal year ends in and the one before", () => {
    expect(framesNeeded([checked("KO", "0000021344", [{ end: "2025-12-31" }, { measure: "netIncome", concept: "us-gaap:NetIncomeLoss", end: "2026-06-30" }])])).toEqual([
      "NetIncomeLoss|CY2025", "NetIncomeLoss|CY2026", "Revenues|CY2024", "Revenues|CY2025",
    ]);
  });

  it("matches the same company and period, and names a figure more than 2% away", () => {
    const frames = new Map([["Revenues|CY2025", [
      { cik: 21344, start: "2025-01-01", end: "2025-12-31", val: 47_941_000_000, accn: "0001628280-26-010047" },
      { cik: 2969, start: "2024-10-01", end: "2025-09-30", val: 12_037_300_000, accn: "0000002969-25-000055" },
    ]]]);
    const agreeing = checked("KO", "0000021344", [{ value: 47_941_000_000 }]);
    const wrong = checked("APD", "0000002969", [{ start: "2024-10-01", end: "2025-09-30", value: 11_000_000_000 }]);
    const unmatched = checked("ZZZ", "0000000001", [{ value: 5 }]);
    const result = compareWithFrames([agreeing, wrong, unmatched], frames);
    expect(result.compared).toBe(2);
    expect(result.disagreements).toEqual([
      { ticker: "APD", measure: "revenue", period: "FY 2025", ours: 11_000_000_000, filed: 12_037_300_000, concept: "us-gaap:Revenues", accession: "0000002969-25-000055" },
    ]);
    const report = summariseAudits([{ ticker: "KO" }, { ticker: "APD" }], new Map([["KO", agreeing], ["APD", wrong]]), new Map(), null, new Date("2026-09-15T12:00:00Z"), result);
    expect(report.totals.disagree).toBe(1);
    expect(report.compared).toBe(2);
  });

  it("does not count a frame read out of a later, different filing as this site's error", () => {
    // DaVita: the frame's 2025 net income comes from its proxy statement, not its 10-K.
    const frames = new Map([["NetIncomeLoss|CY2025", [{ cik: 927066, start: "2025-01-01", end: "2025-12-31", val: 1_079_000_000, accn: "0000927066-26-000053" }]]]);
    const davita = checked("DVA", "0000927066", [{ measure: "netIncome", concept: "us-gaap:NetIncomeLoss", value: 747_000_000, accession: "0000927066-26-000012" }]);
    const result = compareWithFrames([davita], frames);
    expect(result.disagreements[0].otherFiling).toBe(true);
    expect(summariseAudits([{ ticker: "DVA" }], new Map([["DVA", davita]]), new Map(), null, new Date("2026-09-15T12:00:00Z"), result).totals.disagree).toBe(0);
  });

  it("does not count a frame filed in the wrong scale as this site's error", () => {
    // Arista's 2025 net income sits in the SEC frame at 3.5 thousand dollars.
    const frames = new Map([["NetIncomeLoss|CY2025", [{ cik: 1596532, start: "2025-01-01", end: "2025-12-31", val: 3_511_000, accn: "x" }]]]);
    const arista = checked("ANET", "0001596532", [{ measure: "netIncome", concept: "us-gaap:NetIncomeLoss", value: 3_511_000_000 }]);
    const result = compareWithFrames([arista], frames);
    expect(result.disagreements[0].scale).toBe(true);
    expect(summariseAudits([{ ticker: "ANET" }], new Map([["ANET", arista]]), new Map(), null, new Date("2026-09-15T12:00:00Z"), result).totals.disagree).toBe(0);
  });
});
