import { describe, expect, it } from "vitest";
import { latestObservation, parseBlsObservations, parseTreasuryCurve, yearOverYearObservation } from "../lib/macro";

describe("official macro observations", () => {
  it("parses monthly BLS observations and drops annual or missing values", () => {
    const observations = parseBlsObservations([
      { year: "2026", period: "M07", value: "333.918" },
      { year: "2026", period: "M13", value: "333.1" },
      { year: "2026", period: "M06", value: "-" },
    ]);
    expect(observations).toEqual([{ date: "2026-07-01", value: 333.918 }]);
    expect(latestObservation(observations)?.date).toBe("2026-07-01");
  });

  it("calculates inflation against the same month one year earlier", () => {
    const result = yearOverYearObservation([
      { date: "2025-07-01", value: 320 },
      { date: "2026-06-01", value: 328 },
      { date: "2026-07-01", value: 329.6 },
    ]);
    expect(result?.date).toBe("2026-07-01");
    expect(result?.value).toBeCloseTo(3, 10);
  });

  it("fails closed when the prior-year observation is absent", () => {
    expect(yearOverYearObservation([{ date: "2026-07-01", value: 329.6 }])).toBeNull();
  });

  it("reads the latest complete Treasury curve entry", () => {
    const xml = `<feed><entry><d:NEW_DATE>2026-09-03T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.34</d:BC_2YEAR><d:BC_10YEAR>4.77</d:BC_10YEAR></entry><entry><d:NEW_DATE>2026-09-04T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.37</d:BC_2YEAR><d:BC_10YEAR>4.78</d:BC_10YEAR></entry></feed>`;
    expect(parseTreasuryCurve(xml)).toEqual({ date: "2026-09-04", twoYear: 4.37, tenYear: 4.78 });
  });
});
