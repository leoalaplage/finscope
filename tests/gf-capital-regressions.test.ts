import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { debtFromReconciledLiabilities } from "../lib/adapters/debt-free";
import { derivedValue, returnOnAverageCapital } from "../lib/finance";
import { companyView } from "../lib/io/view";
import { buildPreset, PRESETS } from "../lib/term/fundamental-charts";
import type { RawFinancialFact } from "../lib/types";

const payload = JSON.parse(readFileSync(new URL("./fixtures/veev-capital-facts.json", import.meta.url), "utf8"));
const profile = { ticker: "VEEV", name: "VEEVA SYSTEMS INC", cik: "0001393052", exchange: "NYSE", currency: "USD", sector: "Software", description: "", businessType: "operating" as const };
const dataset = normalizeSecPayload(payload, "VEEV", "2026-10-13T15:00:00Z", profile);
const view = companyView(dataset);
const preset = (id: string) => PRESETS.find((entry) => entry.id === id)!;

describe("GF for cash-rich operating companies", () => {
  it("states zero debt and plots net cash equal to cash plus investments", () => {
    const latest = view.quarterly.at(-1)!;
    expect(latest.end).toBe("2026-07-31");
    expect(latest.values.totalDebt).toBe(0);
    expect(latest.values.netDebt).toBe(-7_242_947_000);
    const chart = buildPreset(preset("cash-debt"), view, "quarterly", "5Y", new Map())!;
    expect(chart.series.find((entry) => entry.spec.id === "net")!.values.at(-1)).toBe(7_242_947_000);
    const source = dataset.periods.find((p) => p.periodicity === "quarterly" && p.periodEnd === latest.end)!.facts.totalDebt!;
    expect(source.provenance.status).toBe("calculated");
    expect(source.provenance.note).toContain("reconcile exactly");
  });

  it("recovers the filed D&A total, including quarters and trailing years", () => {
    const year = view.annual.find((period) => period.end === "2025-01-31")!;
    expect(year.values.depreciationAndAmortization).toBe(39_383_000);
    expect(year.values.ebitda).toBe(730_818_000);
    const latest = view.trailing.at(-1)!;
    expect(latest.values.ebitda).toBe(1_075_341_000);
    const chart = buildPreset(preset("earnings"), view, "quarterly", "5Y", new Map())!;
    expect(chart.series.find((entry) => entry.spec.id === "ebitda")!.values.slice(-10).every((value) => value != null)).toBe(true);
  });

  it("draws ROIC on the capital put in, the cash left in: a cash-rich company no longer reads a return of hundreds of per cent", () => {
    const latest = view.trailing.at(-1)!;
    // Netting the cash out gave 373%; debt and equity give 11%.
    expect(latest.values.roic).toBeCloseTo(0.11059381694374436);
    const chart = buildPreset(preset("returns"), view, "quarterly", "5Y", new Map())!;
    expect(chart.series.find((entry) => entry.spec.id === "roic")!.values.at(-1)).toBe(latest.values.roic);
    // Equity less liquid assets went negative in April, and the return with it; with the cash left in, the capital is real.
    expect(view.trailing.find((period) => period.end === "2026-04-30")!.values.roic).not.toBeNull();
    expect(returnOnAverageCapital(100, 20, 30)).toBe(4);
    expect(returnOnAverageCapital(100, 0, 30)).toBeNull();
  });

  it("applies the same normalization to another ticker", () => {
    const other = normalizeSecPayload(payload, "OTHER", dataset.retrievedAt, { ...profile, ticker: "OTHER" });
    expect(companyView(other).trailing.at(-1)!.values).toEqual(view.trailing.at(-1)!.values);
  });

  it("still withholds a return when debt or the capital base is unknown", () => {
    const latest = dataset.periods.find((p) => p.periodicity === "ttm" && p.periodEnd === "2026-07-31")!;
    expect(derivedValue({ ...latest, facts: { ...latest.facts, totalDebt: undefined } }, "roic")).toBeNull();
  });
});

const fact = (value: number, concept = "us-gaap:Liabilities"): RawFinancialFact => ({
  metric: "totalDebt", value, currency: "USD", unit: "currency", end: "2026-07-31", filed: "2026-08-27", accession: "one-filing", fiscalYear: 2027, fiscalPeriod: "Q2", form: "10-Q", concept, sourceUrl: "sec", retrievedAt: "2026-10-13",
});
const parts = [20, 10, 5, 5, 40, 10, 2, 8, 5].map((value) => [fact(value)]);

describe("evidence for an absent borrowing line", () => {
  it("requires both liability totals to reconcile in the same filing", () => {
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], parts, [])[0].value).toBe(0);
    expect(debtFromReconciledLiabilities([fact(106)], [fact(90)], parts, [])).toEqual([]);
    expect(debtFromReconciledLiabilities([fact(105)], [fact(91)], parts, [])).toEqual([]);
    const mixed = parts.map((group) => [...group]);
    mixed[0] = [{ ...fact(20), accession: "different-filing" }];
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], mixed, [])).toEqual([]);
    mixed[0] = [{ ...fact(20), currency: "EUR" }];
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], mixed, [])).toEqual([]);
  });

  it("refuses missing components and any disclosed borrowing, however small", () => {
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], parts, [fact(0.1, "us-gaap:NotesPayable")])).toEqual([]);
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], parts.map((p, i) => i === 2 ? [] : p), [])).toEqual([]);
  });

  it("accepts a combined operating lease only when it exactly closes the two residuals", () => {
    const unsplit = parts.map((p, i) => i === 5 || i === 7 ? [] : p);
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], unsplit, [], [fact(18)])[0].value).toBe(0);
    expect(debtFromReconciledLiabilities([fact(105)], [fact(90)], unsplit, [], [fact(17)])).toEqual([]);
  });
});
