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
    const payload = JSON.parse(readFileSync(new URL("./fixtures/cboe-facts.json", import.meta.url), "utf8"));
    /*
     * The premise, rebuilt. Cboe's newest quarter did carry capital expenditure
     * all along, under a second name — property, plant and equipment for the
     * quarter, productive assets for the half year — which the normalizer now
     * reads. What this test holds is the page's fallback when a newest period
     * has none, so the newest period's capital expenditure is taken out here.
     */
    const us = payload.facts["us-gaap"];
    const ends = (Object.values(us.NetCashProvidedByUsedInOperatingActivities.units) as Array<Array<{ end: string }>>).flat().map((fact) => fact.end).sort();
    const newest = ends.at(-1);
    for (const tag of ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]) {
      for (const facts of Object.values(us[tag]?.units ?? {}) as Array<Array<{ end: string }>>) facts.splice(0, facts.length, ...facts.filter((fact) => fact.end !== newest));
    }
    const view = companyView(normalizeSecPayload(payload, "CBOE", new Date().toISOString(), CBOE));
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
