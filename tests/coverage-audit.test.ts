import { describe, expect, it } from "vitest";
import { auditCompany, summariseAudits, type AuditReport, type CompanyAudit } from "../lib/coverage-audit";
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
