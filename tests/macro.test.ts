import { describe, expect, it } from "vitest";
import {
  MACRO_COUNTRIES,
  macroDefinitionsFor,
  parseBlsObservations,
  parseCsvRows,
  parseEurostatObservation,
  parseEurostatObservations,
  parseSdmxCsvObservation,
  parseSdmxCsvObservations,
  parseTreasuryHistory,
  parseTreasuryRates,
  parseWorldBankObservation,
  rebaseObservations,
  yearOverYearObservations,
} from "../lib/macro";

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

  it("keeps the latest populated World Bank annual observation", () => {
    const payload = [{ page: 1 }, [
      { date: "2025", value: null },
      { date: "2024", value: 2.314 },
      { date: "2023", value: 3.1 },
    ]];
    expect(parseWorldBankObservation(payload)).toEqual({ date: "2024", value: 2.314 });
  });

  it("computes every published monthly inflation rate from BLS index levels", () => {
    const levels = parseBlsObservations([
      { year: "2025", period: "M01", value: "100" },
      { year: "2026", period: "M01", value: "103" },
      { year: "2026", period: "M13", value: "999" },
    ]);
    const inflation = yearOverYearObservations(levels);
    expect(inflation[0].date).toBe("2026-01");
    expect(inflation[0].value).toBeCloseTo(3);
  });

  it("rebases published CPI levels to 100 without changing their relative evolution", () => {
    expect(rebaseObservations([
      { date: "2025-01", value: 125 },
      { date: "2025-02", value: 127.5 },
      { date: "2025-03", value: 131.25 },
    ])).toEqual([
      { date: "2025-01", value: 100 },
      { date: "2025-02", value: 102 },
      { date: "2025-03", value: 105 },
    ]);
    expect(rebaseObservations([{ date: "2025-01", value: 0 }])).toEqual([]);
  });

  it("reads the latest populated Eurostat period", () => {
    const payload = {
      value: { "0": 2.1, "1": 2.4 },
      dimension: { time: { category: { index: { "2026-06": 0, "2026-07": 1, "2026-08": 2 } } } },
    };
    expect(parseEurostatObservation(payload)).toEqual({ date: "2026-07", value: 2.4 });
    expect(parseEurostatObservations(payload)).toEqual([
      { date: "2026-06", value: 2.1 },
      { date: "2026-07", value: 2.4 },
    ]);
  });

  it("parses quoted SDMX CSV cells and selects the latest observation", () => {
    const csv = 'KEY,TITLE,TIME_PERIOD,OBS_VALUE\nA,"Deposit rate, euro area",2026-09-05,2.20\nA,"Deposit rate, euro area",2026-09-06,2.25\n';
    expect(parseCsvRows(csv)[1][1]).toBe("Deposit rate, euro area");
    expect(parseSdmxCsvObservation(csv)).toEqual({ date: "2026-09-06", value: 2.25 });
    expect(parseSdmxCsvObservations(csv)).toHaveLength(2);
  });

  it("extracts a complete Treasury series and computes the curve", () => {
    const xml = `<feed><entry><d:NEW_DATE>2026-09-03T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.34</d:BC_2YEAR><d:BC_10YEAR>4.77</d:BC_10YEAR></entry><entry><d:NEW_DATE>2026-09-04T00:00:00</d:NEW_DATE><d:BC_2YEAR>4.37</d:BC_2YEAR><d:BC_10YEAR>4.78</d:BC_10YEAR></entry></feed>`;
    expect(parseTreasuryHistory(xml, "treasury-10y")).toEqual([
      { date: "2026-09-03", value: 4.77 },
      { date: "2026-09-04", value: 4.78 },
    ]);
    expect(parseTreasuryHistory(xml, "curve")[1].date).toBe("2026-09-04");
    expect(parseTreasuryHistory(xml, "curve")[1].value).toBeCloseTo(0.41);
  });

  it("preserves US rates and adds ECB rates only to euro-area views", () => {
    expect(macroDefinitionsFor("US").find((series) => series.id === "inflation")?.frequency).toBe("Monthly");
    expect(macroDefinitionsFor("US").find((series) => series.id === "gdp-growth")?.frequency).toBe("Quarterly");
    expect(macroDefinitionsFor("US").map((series) => series.id)).toContain("treasury-10y");
    expect(macroDefinitionsFor("FR").map((series) => series.id)).toContain("ecb-rate");
    expect(macroDefinitionsFor("JP").map((series) => series.id)).not.toContain("ecb-rate");
  });

  it("uses the current 21-member Eurostat aggregate", () => {
    expect(MACRO_COUNTRIES.find((country) => country.code === "EA")?.eurostat).toBe("EA21");
  });
});
