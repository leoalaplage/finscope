import { describe, expect, it } from "vitest";
import {
  macroDefinitionsFor,
  parseCsvRows,
  parseEurostatObservation,
  parseSdmxCsvObservation,
  parseTreasuryRates,
  parseWorldBankObservation,
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

  it("reads the latest populated Eurostat period", () => {
    const payload = {
      value: { "0": 2.1, "1": 2.4 },
      dimension: { time: { category: { index: { "2026-06": 0, "2026-07": 1, "2026-08": 2 } } } },
    };
    expect(parseEurostatObservation(payload)).toEqual({ date: "2026-07", value: 2.4 });
  });

  it("parses quoted SDMX CSV cells and selects the latest observation", () => {
    const csv = 'KEY,TITLE,TIME_PERIOD,OBS_VALUE\nA,"Deposit rate, euro area",2026-09-05,2.20\nA,"Deposit rate, euro area",2026-09-06,2.25\n';
    expect(parseCsvRows(csv)[1][1]).toBe("Deposit rate, euro area");
    expect(parseSdmxCsvObservation(csv)).toEqual({ date: "2026-09-06", value: 2.25 });
  });

  it("preserves US rates and adds ECB rates only to euro-area views", () => {
    expect(macroDefinitionsFor("US").map((series) => series.id)).toContain("treasury-10y");
    expect(macroDefinitionsFor("FR").map((series) => series.id)).toContain("ecb-rate");
    expect(macroDefinitionsFor("JP").map((series) => series.id)).not.toContain("ecb-rate");
  });
});
