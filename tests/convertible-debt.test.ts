import { describe, expect, it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { derivedValue, valueOf } from "../lib/finance";
import type { CompanyDataset, CompanyProfile } from "../lib/types";

/**
 * A convertible note is borrowing, and for a whole generation of filers it is
 * the only borrowing there is.
 *
 * Cloudflare, Snowflake and Shopify fund themselves with converts and tag them
 * under concepts this adapter did not read, so each came out with no debt
 * balance at all — and with it no net debt, no enterprise value and no
 * EV/EBITDA. Cloudflare carries $3.27bn of notes against $1.66bn of cash.
 */

const profile: CompanyProfile = {
  name: "Test", ticker: "TEST", cik: "0000000001", exchange: "NYSE", currency: "USD",
  sector: "Software", description: "A fixture.", businessType: "operating",
};

type Fact = { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string };
const at = (end: string, val: number, filed = `${end.slice(0, 4)}-12-31`): Fact =>
  ({ end, val, accn: `a-${end}`, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed });
const spanning = (end: string, val: number): Fact =>
  ({ ...at(end, val), start: `${Number(end.slice(0, 4))}-01-01` });

function build(balances: Record<string, Fact[]>): CompanyDataset {
  return normalizeSecPayload({
    entityName: "Test",
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [spanning("2025-12-31", 1_000)] } },
        CashAndCashEquivalentsAtCarryingValue: { units: { USD: [at("2025-12-31", 400)] } },
        ...Object.fromEntries(Object.entries(balances).map(([tag, facts]) => [tag, { units: { USD: facts } }])),
      },
    },
  }, "TEST", "2026-02-01T00:00:00.000Z", profile);
}

const year = (dataset: CompanyDataset) => dataset.periods.find((item) => item.periodicity === "annual")!;

describe("borrowings a filer states as convertible notes", () => {
  it("sums the current and non-current halves, which are separate lines", () => {
    const dataset = build({
      ConvertibleDebtCurrent: [at("2025-12-31", 300)],
      ConvertibleDebtNoncurrent: [at("2025-12-31", 700)],
    });
    expect(valueOf(year(dataset), "totalDebt")).toBe(1_000);
    expect(derivedValue(year(dataset), "netDebt")).toBe(600);
  });

  it("reads a lone non-current balance, saying what it leaves out", () => {
    const dataset = build({ ConvertibleDebtNoncurrent: [at("2025-12-31", 700)] });
    expect(valueOf(year(dataset), "totalDebt")).toBe(700);
    expect(year(dataset).facts.totalDebt?.provenance.note).toContain("not separately tagged");
  });

  it("leaves a conventional balance in charge where the filer files one", () => {
    // A filer publishing its own long-term total is not made to add a note
    // concept to it: the total is the total, and the convert is inside it.
    const dataset = build({
      LongTermDebtNoncurrent: [at("2025-12-31", 900)],
      ConvertibleDebtNoncurrent: [at("2025-12-31", 700)],
    });
    expect(valueOf(year(dataset), "totalDebt")).toBe(900);
  });
});

describe("a balance sheet that says nothing is owed", () => {
  it("reads a filed nought as the nought it is", () => {
    // Shopify repaid its notes; the next annual report files the line at zero.
    const dataset = build({ ConvertibleDebtCurrent: [at("2025-12-31", 0)] });
    expect(valueOf(year(dataset), "totalDebt")).toBe(0);
    expect(derivedValue(year(dataset), "netDebt")).toBe(-400);
  });

  it("never reads an absence as one", () => {
    // The distinction the whole application is built on: a filer that tags no
    // borrowing line at all is unknown, not debt-free.
    const dataset = build({});
    expect(valueOf(year(dataset), "totalDebt")).toBeNull();
    expect(derivedValue(year(dataset), "netDebt")).toBeNull();
  });

  it("keeps a real balance where one line is nought and another is not", () => {
    const dataset = build({
      ConvertibleDebtCurrent: [at("2025-12-31", 0)],
      ConvertibleDebtNoncurrent: [at("2025-12-31", 700)],
    });
    expect(valueOf(year(dataset), "totalDebt")).toBe(700);
  });
});
