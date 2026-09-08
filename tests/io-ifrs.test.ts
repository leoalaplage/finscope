import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeSecPayload, SEC_CONCEPTS } from "../lib/adapters/sec";
import { companyView } from "../lib/io/view";

/**
 * A filer that keeps its books under IFRS.
 *
 * Ten per cent of the coverage sweep reported under IFRS on Form 20-F, and not
 * one concept in the US GAAP map exists in such a filing — so SAP, Shell,
 * AstraZeneca, Novo Nordisk, HSBC and UBS are all listed in New York and all
 * normalized to nothing. The fixtures here are their own company-facts
 * documents, cut to the concepts this adapter reads.
 *
 * Nothing is reconciled between the two standards. An operating profit struck
 * under IFRS is not the same measurement as one struck under US GAAP, and this
 * reads what the filer published rather than pretending otherwise.
 */
const filer = (ticker: string, cik: string, name: string) => ({
  name, ticker, yahooTicker: ticker, cik, regulatoryId: `CIK ${cik}`,
  exchange: "NASDAQ", currency: "USD", sector: "Pharmaceuticals", description: name,
  businessType: "operating" as const, resolutionStatus: "verified" as const,
});

const view = (ticker: string, cik: string, name: string) => companyView(normalizeSecPayload(
  JSON.parse(readFileSync(new URL(`./fixtures/${ticker.toLowerCase()}-facts.json`, import.meta.url), "utf8")),
  ticker, "2026-09-08T00:00:00Z", filer(ticker, cik, name),
));

describe("an IFRS filer on Form 20-F", () => {
  it("reads AstraZeneca's statements, which reported in dollars", () => {
    const azn = view("AZN", "0000901832", "AstraZeneca PLC");
    const year = azn.annual.at(-1)!;
    expect(azn.annual.length).toBeGreaterThan(5);
    expect(azn.company.currency).toBe("USD");
    // Filed 2025: $58.7bn of revenue, $13.7bn of operating profit, $10.2bn net.
    expect(year.values.revenue! / 1e9).toBeCloseTo(58.7, 0);
    expect(year.values.operatingIncome! / 1e9).toBeCloseTo(13.7, 0);
    expect(year.values.netIncome! / 1e9).toBeCloseTo(10.2, 0);
    // Cash capital expenditure is filed, so free cash flow is a subtraction and
    // not an estimate.
    expect(year.values.capitalExpenditures! / 1e9).toBeCloseTo(2.8, 0);
    expect(year.values.freeCashFlow! / 1e9).toBeCloseTo(11.8, 0);
    // The share count is `AdjustedWeightedAverageShares`, which contains
    // neither "diluted" nor "ordinary" — the name had to come from the filings
    // rather than from the standard's own labels.
    expect(year.values.dilutedShares! / 1e9).toBeCloseTo(1.6, 1);
    expect(year.valuationBasis).not.toBeNull();
  });

  it("keeps SAP's books in the currency SAP keeps them in", () => {
    /*
     * The currency test used to read only the US GAAP taxonomy, so every IFRS
     * filer inherited whatever its registry entry declared — dollars. That is
     * the test deciding whether a dollar quote may be multiplied by a filed
     * share count, so getting it wrong would not mislabel a multiple, it would
     * invent one.
     */
    const sap = view("SAP", "0001000184", "SAP SE");
    const year = sap.annual.at(-1)!;
    expect(sap.company.currency).toBe("EUR");
    expect(year.values.revenue! / 1e9).toBeCloseTo(36.8, 0);
    expect(year.values.operatingCashFlow! / 1e9).toBeCloseTo(9.2, 0);
  });

  it("withholds a free cash flow SAP does not file the cash for", () => {
    /*
     * SAP tags no cash capital expenditure at all — only additions to property,
     * plant and equipment, which is what the balance grew by rather than what
     * was paid. Reading one as the other is the silent substitution this
     * application refuses, so the figure is absent and says so.
     */
    const year = view("SAP", "0001000184", "SAP SE").annual.at(-1)!;
    expect(year.values.capitalExpenditures).toBeNull();
    expect(year.values.freeCashFlow).toBeNull();
  });

  it("offers IFRS names only after the US GAAP ones", () => {
    // A US filer must read exactly as it did: the IFRS tags are appended as a
    // further taxonomy, never inserted ahead of the concepts already preferred.
    const revenue = SEC_CONCEPTS.revenue;
    expect(revenue.namespace).toBe("us-gaap");
    expect(revenue.tags[0]).toBe("RevenueFromContractWithCustomerExcludingAssessedTax");
    expect(revenue.also?.at(-1)).toEqual({ namespace: "ifrs-full", tags: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods"] });
  });
});
