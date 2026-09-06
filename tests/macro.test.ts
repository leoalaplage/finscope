import { describe, expect, it } from "vitest";
import { parseTreasuryRates } from "../lib/macro";

describe("official macro observations", () => {
  it("reads the latest complete Treasury curve entry", () => {
    const xml = `<feed><entry><d:NEW_DATE>2026-09-03T00:00:00</d:NEW_DATE><d:BC_3MONTH>3.89</d:BC_3MONTH><d:BC_2YEAR>4.34</d:BC_2YEAR><d:BC_10YEAR>4.77</d:BC_10YEAR><d:BC_30YEAR>5.25</d:BC_30YEAR></entry><entry><d:NEW_DATE>2026-09-04T00:00:00</d:NEW_DATE><d:BC_3MONTH>3.91</d:BC_3MONTH><d:BC_2YEAR>4.37</d:BC_2YEAR><d:BC_10YEAR>4.78</d:BC_10YEAR><d:BC_30YEAR>5.24</d:BC_30YEAR></entry></feed>`;
    expect(parseTreasuryRates(xml)).toEqual({
      date: "2026-09-04",
      threeMonth: 3.91,
      twoYear: 4.37,
      tenYear: 4.78,
      thirtyYear: 5.24,
    });
  });

  it("rejects an incomplete latest curve", () => {
    const xml = `<feed><entry><d:NEW_DATE>2026-09-04T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.37</d:BC_2YEAR><d:BC_10YEAR>4.78</d:BC_10YEAR></entry></feed>`;
    expect(parseTreasuryRates(xml)).toBeNull();
  });
});
