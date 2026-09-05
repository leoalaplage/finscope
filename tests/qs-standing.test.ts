import { describe, expect, it } from "vitest";
import { NOMS_METRIQUES } from "../lib/qs/qs-config.js";
import { asStrength, asWeakness } from "../lib/qs/standing";

/**
 * The one judgement this application offers, said the right way round.
 *
 * Booking is scored badly on long-term debt because it carries a great deal of
 * it, and the page reported its weakness as "Low LT debt" — the name of the
 * virtue it failed to reach, which reads as the opposite of the finding.
 */
describe("how a criterion is said", () => {
  it("names the failing, not the virtue that was missed", () => {
    expect(asWeakness("Low LT debt")).toBe("High long-term debt");
    expect(asWeakness("Low dilution")).toBe("Share dilution");
    expect(asWeakness("Low leverage")).toBe("High leverage");
    expect(asWeakness("High interest coverage")).toBe("Thin interest coverage");
    expect(asWeakness("Attractive EV/FCF")).toBe("Expensive on EV/FCF");
    expect(asWeakness("FCF yield")).toBe("Low FCF yield");
  });

  it("names the strength as a strength", () => {
    expect(asStrength("Low LT debt")).toBe("Low long-term debt");
    expect(asStrength("ROIC")).toBe("High ROIC");
    expect(asStrength("Attractive EV/FCF")).toBe("Cheap on EV/FCF");
  });

  it("says something different in each list, for every measure scored", () => {
    // A criterion the table has never heard of would appear under both lists
    // with the same words, which is the bug this exists to prevent.
    for (const label of Object.values(NOMS_METRIQUES) as string[]) {
      expect(asStrength(label), label).not.toBe(asWeakness(label));
    }
  });

  it("still says something for a criterion it has never heard of", () => {
    expect(asWeakness("Something new")).toBe("Something new");
  });
});
