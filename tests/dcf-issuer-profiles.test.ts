import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { balanceSheetIsTheBusiness } from "../lib/business-type";
import { companyView } from "../lib/io/view";
import { assumptionsFrom, dcfFoundation, dcfMissingInputs, defaultDrivers, justifiedBook, scenarioDrivers, valueWith } from "../lib/io/dcf-model";
import type { BusinessType, CompanyDataset } from "../lib/types";

const tickers = ["AAPL", "NVDA", "MSFT", "AMZN", "MA", "INTU", "HIMS", "ECL", "VLO", "URI", "ANET", "VZ", "DAL", "FTV", "RSG", "JPM", "TRV", "UNH", "BRK-B", "IVZ", "PLD", "ASML", "TSM", "COST", "CPRT", "KO", "BKNG", "ADBE", "LLY", "CELH"];

const datasetOf = (ticker: string): CompanyDataset => {
  const raw = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/golden/${ticker.toLowerCase()}.json.gz`, import.meta.url))).toString());
  const type: BusinessType = ticker === "JPM" ? "bank" : ticker === "TRV" ? "insurer" : ticker === "BRK-B" ? "holding" : "operating";
  return normalizeSecPayload(raw, ticker, "2026-10-17", {
    ticker, name: raw.entityName, cik: String(raw.cik ?? "0000000001"), currency: ticker === "ASML" ? "EUR" : ticker === "TSM" ? "TWD" : "USD",
    exchange: "NYSE", sector: "", description: "", businessType: type,
  });
};

const expectFiniteValues = (value: unknown) => {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(expectFiniteValues);
  else if (value != null && typeof value === "object") Object.values(value).forEach(expectFiniteValues);
};

describe("DCF boundaries across thirty real issuer profiles", () => {
  for (const ticker of tickers) {
    it(`${ticker}: returns an auditable finite operating model or explains its unavailability`, () => {
      const dataset = datasetOf(ticker);
      const view = companyView(dataset);
      if (balanceSheetIsTheBusiness(dataset.company.businessType)) {
        // This is the same gate used by the company panel and terminal screen.
        // Lenders never pass through the FCFF workbench.
        const book = justifiedBook(view, .10, .025);
        if (book) expectFiniteValues(book);
        expect(["bank", "broker", "financial", "insurer"]).toContain(dataset.company.businessType);
        return;
      }
      const foundation = dcfFoundation(view);
      if (!foundation) {
        expect(dcfMissingInputs(view).length).toBeGreaterThan(0);
        return;
      }
      const basePeriod = [...view.annual, ...view.trailing].find(period => period.end === foundation.basePeriod.end && period.label === foundation.basePeriod.label)!;
      expect(basePeriod.currency).toBe(dataset.company.currency);
      expect(foundation.base.revenue).toBe(basePeriod.values.revenue);
      expect(foundation.base.debt).toBe(basePeriod.values.totalDebt);
      expect(foundation.base.cash).toBe(basePeriod.values.cashAndEquivalents! + Math.max(0, basePeriod.values.shortTermInvestments ?? 0));
      expectFiniteValues(foundation);
      const drivers = defaultDrivers(foundation, .10, 100e9, .045);
      expect(drivers.dilution).toBe(0);
      for (const scenario of ["bear", "base", "bull"] as const) {
        const assumptions = scenarioDrivers(drivers, scenario);
        expect(assumptions.dilution).toBe(0);
        const result = valueWith(foundation, assumptions);
        expectFiniteValues(result);
        if (result.intrinsicValuePerShare == null) expect(result.warnings.length).toBeGreaterThan(0);
        else {
          expect(result.valuationShares).toBe(foundation.base.dilutedShares);
          expect(result.equityValue).toBeCloseTo(result.enterpriseValue! + foundation.base.cash - foundation.base.debt - assumptions.otherClaims, 2);
          expect(Math.abs(result.intrinsicValuePerShare * result.valuationShares - result.equityValue!)).toBeLessThan(Math.max(1, Math.abs(result.equityValue!) * 1e-12));
          const last = result.projections.at(-1)!;
          const inputs = assumptionsFrom(assumptions, foundation);
          const nextOperating = last.revenue * (1 + inputs.terminalGrowth) * last.operatingMargin;
          const nextNopat = nextOperating - Math.max(0, nextOperating) * inputs.terminalTaxRate!;
          expect(result.terminalCashFlow).toBeCloseTo(nextNopat * (1 - inputs.terminalGrowth / inputs.terminalReturnOnCapital!), 2);
          expect(result.projections.every(row => row.dilutedShares === foundation.base.dilutedShares)).toBe(true);
        }
      }
    });
  }
});
