import { describe, expect, it } from "vitest";
import { nasdaqSymbol, parseEstimates } from "@/lib/adapters/nasdaq-estimates";
import { expectedGrowth, forwardReading, nextTwelveMonthsEps, recordSnapshot, snapshotOf } from "@/lib/estimates";

// Nasdaq's answers for Microsoft on 12 October 2026, trimmed to what is read.
const forecast = {
  quarterlyForecast: { rows: [
    { fiscalEnd: "Sep 2026", consensusEPSForecast: 4.71, highEPSForecast: 4.84, lowEPSForecast: 4.62, noOfEstimates: 13, up: 0, down: 1 },
    { fiscalEnd: "Dec 2026", consensusEPSForecast: 4.84, highEPSForecast: 4.95, lowEPSForecast: 4.71, noOfEstimates: 12, up: 2, down: 0 },
    { fiscalEnd: "Mar 2027", consensusEPSForecast: 4.85, highEPSForecast: 4.98, lowEPSForecast: 4.74, noOfEstimates: 12, up: 2, down: 0 },
    { fiscalEnd: "Jun 2027", consensusEPSForecast: 5.14, highEPSForecast: 5.32, lowEPSForecast: 4.85, noOfEstimates: 12, up: 2, down: 0 },
    { fiscalEnd: "Sep 2027", consensusEPSForecast: 5.44, highEPSForecast: 5.82, lowEPSForecast: 4.69, noOfEstimates: 11, up: 0, down: 0 },
  ] },
  yearlyForecast: { rows: [
    { fiscalEnd: "Jun 2027", consensusEPSForecast: 19.65, highEPSForecast: 20.4, lowEPSForecast: 18.92, noOfEstimates: 20, up: 2, down: 1 },
    { fiscalEnd: "Jun 2028", consensusEPSForecast: 23.24, highEPSForecast: 24.13, lowEPSForecast: 21.8, noOfEstimates: 17, up: 1, down: 2 },
  ] },
};
const momentum = { changeInConsensus: {
  monthData: { qtrMean: 4.7, yrMean: 19.61 }, weekData: { qtrMean: 4.71, yrMean: 19.65 }, currentData: { qtrMean: 4.71, yrMean: 19.65 },
  fiscalYearEndText: "Fiscal Year End Jun 2027", fiscalQtrEndText: "Fiscal Quarter End Sep 2026",
} };
const target = {
  consensusOverview: { lowPriceTarget: 440.0, highPriceTarget: 725.0, priceTarget: 587.27, buy: 34, sell: 0, hold: 1 },
  historicalConsensus: [{ z: { buy: 33, hold: 1, sell: 0, date: "10/01/2025" }, x: 1759276800, y: 519.71 }],
};
const ratings = { meanRatingType: "Buy", brokerNames: ["ARGUS RESEARCH", "GOLDMAN SACHS", "UBS"] };

const msft = parseEstimates("msft", forecast, momentum, target, ratings, "2026-10-12T08:00:00Z");

describe("analysts' estimates from Nasdaq", () => {
  it("reads the consensus by quarter and by year, with its spread and revisions", () => {
    expect(msft.ticker).toBe("MSFT");
    expect(msft.quarterly).toHaveLength(5);
    expect(msft.quarterly[0]).toEqual({ fiscalEnd: "Sep 2026", consensus: 4.71, high: 4.84, low: 4.62, analysts: 13, up: 0, down: 1 });
    expect(msft.yearly.map((row) => row.consensus)).toEqual([19.65, 23.24]);
    expect(msft.momentum?.year).toEqual({ label: "Jun 2027", now: 19.65, weekAgo: 19.65, monthAgo: 19.61 });
  });

  it("reads the price target and the recommendations, and dates their history", () => {
    expect(msft.target).toEqual({ low: 440, mean: 587.27, high: 725 });
    expect(msft.ratings).toEqual({ buy: 34, hold: 1, sell: 0, label: "Buy", brokers: 3 });
    expect(msft.ratingHistory).toEqual([{ date: "2025-10-01", buy: 33, hold: 1, sell: 0 }]);
  });

  it("is empty, not invented, where nothing answered", () => {
    const none = parseEstimates("XYZ", null, null, null, null, "2026-10-12T08:00:00Z");
    expect(none.quarterly).toEqual([]);
    expect(none.target).toBeNull();
    expect(none.ratings).toBeNull();
  });

  it("asks Nasdaq for a share class with a dot", () => {
    expect(nasdaqSymbol("brk-b")).toBe("BRK.B");
  });
});

describe("what the estimates imply", () => {
  it("strikes the forward P/E on the next four quarters' expected EPS", () => {
    expect(nextTwelveMonthsEps(msft)).toBeCloseTo(4.71 + 4.84 + 4.85 + 5.14, 6);
    const reading = forwardReading(msft, 535.07);
    expect(reading.forwardPe).toBeCloseTo(535.07 / 19.54, 4);
    expect(reading.growth).toBeCloseTo(23.24 / 19.65 - 1, 6);
    expect(reading.peg).toBeCloseTo(reading.forwardPe! / (reading.growth! * 100), 6);
    expect(reading.upside).toBeCloseTo(587.27 / 535.07 - 1, 6);
    expect(reading.buyShare).toBeCloseTo(34 / 35, 6);
  });

  it("states no forward P/E on expected losses and no PEG without growth", () => {
    const losing = { ...msft, quarterly: msft.quarterly.map((row) => ({ ...row, consensus: -0.5 })), yearly: [{ ...msft.yearly[0], consensus: -2 }, { ...msft.yearly[1], consensus: -1 }] };
    const reading = forwardReading(losing, 100);
    expect(reading.forwardPe).toBeNull();
    expect(reading.peg).toBeNull();
    expect(expectedGrowth(losing)).toBeNull();
  });

  it("falls back to the fiscal year when four quarters are not covered", () => {
    expect(nextTwelveMonthsEps({ quarterly: msft.quarterly.slice(0, 2), yearly: msft.yearly })).toBe(19.65);
  });
});

describe("the consensus history", () => {
  it("keeps one snapshot a day, the latest of the day, oldest first, two years at most", () => {
    const first = snapshotOf(msft, "2026-10-11");
    const later = { ...snapshotOf(msft, "2026-10-12"), fy1: 19.7 };
    const again = { ...later, fy1: 19.72 };
    const old = { ...first, date: "2024-01-01" };
    const history = recordSnapshot(recordSnapshot(recordSnapshot([old], first), later), again);
    expect(history.map((entry) => [entry.date, entry.fy1])).toEqual([["2026-10-11", 19.65], ["2026-10-12", 19.72]]);
    expect(first.ntm).toBeCloseTo(19.54, 6);
    expect(first.fy1End).toBe("Jun 2027");
  });
});
