import { describe, expect, it } from "vitest";
import { priceForStatements, type IoQuote } from "../components/io/quote";
import { sharesPerReceipt } from "../lib/adr";
import { absenceOf } from "../lib/io/absence";
import type { IoCompanyView } from "../lib/io/view";

const quote = (ticker: string, price: number, currency = "USD"): IoQuote =>
  ({ ticker, symbol: ticker, name: ticker, price, previousClose: null, change: null, changePercent: null, currency, asOf: null });

describe("a foreign company's price, per ordinary share in its statements' currency", () => {
  it("divides Taiwan Semiconductor's receipt into five shares and converts dollars into Taiwan dollars", () => {
    const priced = priceForStatements(quote("TSM", 200), "TWD", { rate: 32, asOf: "2026-09-15" }, sharesPerReceipt("TSM"));
    expect(priced?.currency).toBe("TWD");
    expect(priced?.price).toBeCloseTo((200 / 5) * 32, 6);
    expect(priced?.conversion).toEqual({ from: "USD", rate: 32, asOf: "2026-09-15", sharesPerReceipt: 5 });
  });

  it("doubles a half-share receipt though the statements are in the quote's currency", () => {
    const priced = priceForStatements(quote("HALF", 75), "USD", null, 0.5);
    expect(priced?.price).toBe(150);
    expect(priced?.conversion?.rate).toBeNull();
  });

  it("leaves AstraZeneca's price alone: it lists its ordinary shares in New York, not receipts", () => {
    expect(sharesPerReceipt("AZN")).toBeNull();
    const azn = quote("AZN", 162.23);
    expect(priceForStatements(azn, "USD", null, sharesPerReceipt("AZN"))).toBe(azn);
  });

  it("converts ASML's one-for-one receipt from dollars into euros", () => {
    const priced = priceForStatements(quote("ASML", 1000), "EUR", { rate: 0.9, asOf: null }, sharesPerReceipt("ASML"));
    expect(priced?.price).toBeCloseTo(900, 6);
    expect(priced?.conversion?.sharesPerReceipt).toBeNull();
  });

  it("leaves a price unconverted, so the valuation stays withheld, when the receipt's ratio or the rate is unknown", () => {
    const unknown = quote("XYZ", 10);
    expect(priceForStatements(unknown, "EUR", { rate: 0.9, asOf: null }, sharesPerReceipt("XYZ"))).toBe(unknown);
    const asml = quote("ASML", 1000);
    expect(priceForStatements(asml, "EUR", null, 1)).toBe(asml);
  });

  it("leaves a domestic company's quote exactly as it trades", () => {
    const apple = quote("AAPL", 230);
    expect(priceForStatements(apple, "USD", null, sharesPerReceipt("AAPL"))).toBe(apple);
  });
});

describe("why a figure is not on the page", () => {
  const view = (businessType: string | null, values: Array<Record<string, number | null>>) => ({
    company: { businessType },
    withheldReason: businessType === "bank" ? "Free cash flow, net debt and returns on invested capital are not stated for this filer." : null,
    annual: values.map((each) => ({ values: each })),
    quarterly: [],
    trailing: [],
  }) as unknown as IoCompanyView;

  it("tells apart a measure withheld by design, one never filed, and one missing for a period", () => {
    expect(absenceOf(view("bank", [{ freeCashFlow: null }]), "freeCashFlow").kind).toBe("withheld");
    expect(absenceOf(view("operating", [{ researchAndDevelopment: null }]), "researchAndDevelopment").kind).toBe("never-filed");
    expect(absenceOf(view("operating", [{ capitalExpenditures: 5 }, { capitalExpenditures: null }]), "capitalExpenditures").kind).toBe("not-this-period");
  });
});
