import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { companyView } from "../lib/io/view";

/*
 * The fixture is CBOE's own SEC company-facts document, cut to the concepts
 * this adapter reads. Refresh it with:
 *
 *   SEC_USER_AGENT="you you@example.com" node scripts/fetch-fixture.mjs CBOE 0001374310
 */
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
    const view = companyView(normalizeSecPayload(JSON.parse(readFileSync(new URL("./fixtures/cboe-facts.json", import.meta.url), "utf8")), "CBOE", new Date().toISOString(), CBOE));
    expect(view.ttm?.values.freeCashFlow).toBeNull();
    const carried = [...view.trailing].reverse().find((period) => period.values.freeCashFlow != null);
    expect(carried).toBeDefined();
    /*
     * The figure that was vanishing, asserted rather than printed to a file in
     * /tmp for a human to read. The carried period must be a real trailing
     * window with a real free cash flow, and it must be older than the newest
     * one — otherwise this passes on the very period it exists to prove is
     * empty.
     */
    expect(carried!.end < view.ttm!.end).toBe(true);
    expect(carried!.values.freeCashFlow!).toBeGreaterThan(0);
  });
});
