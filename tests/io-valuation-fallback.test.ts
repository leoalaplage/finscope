import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { companyView } from "../lib/io/view";
import { normalizeSecPayload } from "../lib/adapters/sec";

const CBOE = {
  name: "Cboe Global Markets, Inc.", ticker: "CBOE", yahooTicker: "CBOE", cik: "0001374310",
  regulatoryId: "CIK 0001374310", exchange: "Cboe BZX", currency: "USD", sector: "Exchanges",
  description: "Options, equities and derivatives market infrastructure.",
  businessType: "exchange" as const, resolutionStatus: "verified" as const,
};

describe("a denominator the newest period does not report", () => {
  it("is still there one period back", () => {
    /*
     * The bug this exists for. A filer does not tag every line at once: Cboe's
     * newest quarter carried an operating cash flow and no capital expenditure,
     * so the trailing period built from it had no free cash flow — and the
     * price-to-free-cash-flow and the free-cash-flow yield vanished for a
     * company whose free cash flow was sitting one quarter back, complete.
     */
    const view = companyView(normalizeSecPayload(JSON.parse(readFileSync("/tmp/cboe-facts.json", "utf8")), "CBOE", new Date().toISOString(), CBOE));
    expect(view.ttm?.values.freeCashFlow).toBeNull();
    const carried = [...view.trailing].reverse().find((period) => period.values.freeCashFlow != null);
    expect(carried).toBeDefined();
    writeFileSync("/tmp/fallback.out", `${view.ttm?.label} n'a pas de FCF; ${carried?.label} en a ${(carried!.values.freeCashFlow! / 1e9).toFixed(2)}B`);
  });
});
