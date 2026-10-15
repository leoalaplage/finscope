import { describe, expect, it } from "vitest";
import { fedOdds, parseFomc, zqSymbol } from "../lib/fedwatch";
import { rateRows } from "../lib/rates";
import { signalsOf } from "../lib/home-signals";
import { phaseAt, sessionSummary } from "../lib/session-summary";

describe("the Fed's odds from fed funds futures", () => {
  const page = `
    <h4>2026 FOMC Meetings</h4>
    <div class="fomc-meeting__month col-xs-5"><strong>October</strong></div><div class="fomc-meeting__date col-xs-4">27-28</div>
    <div class="fomc-meeting__month col-xs-5"><strong>December</strong></div><div class="fomc-meeting__date col-xs-4">8-9*</div>
    <div class="fomc-meeting__month col-xs-5"><strong>Apr/May</strong></div><div class="fomc-meeting__date col-xs-4">30-1</div>
    <h4>2027 FOMC Meetings</h4>
    <div class="fomc-meeting__month col-xs-5"><strong>January</strong></div><div class="fomc-meeting__date col-xs-4">26-27</div>
    <div class="fomc-meeting__month col-xs-5"><strong>March</strong></div><div class="fomc-meeting__date col-xs-4">16-17*</div>
    <div class="fomc-meeting__month col-xs-5"><strong>August</strong></div><div class="fomc-meeting__date col-xs-4">24 (notation vote)</div>`;

  it("reads the calendar as decision days, a meeting across two months on its last, a notation vote left out", () => {
    expect(parseFomc(page).map((meeting) => meeting.date)).toEqual(["2026-05-01", "2026-10-28", "2026-12-09", "2027-01-27", "2027-03-17"]);
    expect(zqSymbol(2026, 11)).toBe("ZQX26.CBT");
    expect(zqSymbol(2027, 1)).toBe("ZQF27.CBT");
  });

  it("chains the meetings from today's effective rate, as CME reads the contracts (prices of 15 October 2026)", () => {
    const prices = { "2026-10": 96.113, "2026-11": 96.045, "2026-12": 95.885, "2027-01": 95.815, "2027-02": 95.725, "2027-03": 95.655 };
    const rows = fedOdds({ effr: 3.88, lower: 3.75, meetings: parseFomc(page), prices, today: "2026-10-15" });
    // October: November has no meeting, so its contract is the rate after October's decision whole.
    expect(rows[0]).toMatchObject({ date: "2026-10-28", implied: 3.955, move: 7.5, odds: { 0: 0.7, 25: 0.3 } });
    expect(rows[0].ranges).toEqual([{ lower: 3.75, upper: 4, p: 0.7 }, { lower: 4, upper: 4.25, p: 0.3 }]);
    // December: January meets too, so December's own contract is split at the 9th.
    expect(rows[1].date).toBe("2026-12-09");
    expect(rows[1].implied).toBeCloseTo(4.18, 2);
    expect(rows[1].fromToday).toBeCloseTo(30, 0);
    expect(rows[1].ranges.map((range) => range.lower)).toEqual([4, 4.25]);
    expect(Object.values(rows[1].odds).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 2);
  });

  it("stops where a contract is missing rather than guessing the rest", () => {
    const rows = fedOdds({ effr: 3.88, meetings: parseFomc(page), prices: { "2026-11": 96.045 }, today: "2026-10-15" });
    expect(rows.map((row) => row.date)).toEqual(["2026-10-28"]);
  });

  it("reads a cut as a cut", () => {
    const rows = fedOdds({ effr: 4.33, meetings: [{ date: "2026-10-28" }], prices: { "2026-11": 100 - 4.08 }, today: "2026-10-01" });
    expect(rows[0].odds).toEqual({ "-25": 1 });
  });
});

describe("Treasuries and the dollar", () => {
  it("draws the spreads from the yields and writes moves in basis points", () => {
    const rows = rateRows({ US3M: { last: 4.1, change: 0 }, US2Y: { last: 4.734, change: -0.068 }, US10Y: { last: 5.085, change: -0.1 }, US30Y: { last: 5.3, change: null } }, { last: 98.5, change: -0.31 });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.US2Y).toMatchObject({ last: 4.734, change: -6.8 });
    expect(byId["2s10s"]).toMatchObject({ last: 35.1, change: -3.2 });
    expect(byId["3m10y"].last).toBeCloseTo(98.5, 1);
    expect(byId.US30Y.change).toBeNull();
    expect(byId.DXY).toMatchObject({ last: 98.5, change: -0.31, unit: "index" });
  });

  it("leaves a spread out when either yield is missing", () => {
    const rows = rateRows({ US10Y: { last: 5, change: 0.01 } }, null);
    expect(rows.find((row) => row.id === "2s10s")?.last).toBeNull();
    expect(rows.find((row) => row.id === "DXY")?.last).toBeNull();
  });
});

describe("new highs, new lows and heavy volume", () => {
  const row = (ticker: string, values: Record<string, [number | null, number | null]>) => ({ ticker, name: ticker, asOf: Date.parse("2026-10-14T00:00:00Z") / 1000, values });
  const rows = [
    // Set a new high in the last session.
    row("AAA", { close: [110, 100], high: [111, 101], low: [100, 99], high52: [111, 105], low52: [50, 50], volumeRatio: [1.1, 1], chg1: [10, 0] }),
    // Above the year's high now.
    row("BBB", { close: [50, 49], high: [51, 50], low: [48, 48], high52: [60, 60], low52: [40, 40], volumeRatio: [3.2, 1], chg1: [2, 0] }),
    // At a new low in the last session, and on the reader's list though outside the index.
    row("CCC", { close: [20, 22], high: [22, 23], low: [19, 21], high52: [40, 40], low52: [19, 21], volumeRatio: [0.9, 1], chg1: [-9, 0] }),
    row("DDD", { close: [30, 30], high: [31, 31], low: [29, 29], high52: [40, 40], low52: [20, 20], volumeRatio: [1, 1], chg1: [0, 0] }),
  ];
  it("tells today from the last session, counts the index's alone and puts the reader's names first", () => {
    const signals = signalsOf({ rows, prices: { BBB: { price: 61, changePercent: 4 } }, members: new Set(["AAA", "BBB", "DDD"]), watched: new Set(["CCC"]) });
    expect(signals.session).toBe("2026-10-14");
    expect(signals.highs.map((signal) => [signal.ticker, signal.when])).toEqual([["AAA", "last"], ["BBB", "today"]]);
    expect(signals.highs.find((signal) => signal.ticker === "BBB")?.change).toBeCloseTo(0.04);
    expect(signals.lows.map((signal) => [signal.ticker, signal.watched])).toEqual([["CCC", true]]);
    expect(signals.volume.map((signal) => [signal.ticker, signal.ratio])).toEqual([["BBB", 3.2]]);
    expect(signals.counts).toEqual({ highs: 2, lows: 0, volume: 1, members: 3 });
  });
});

describe("the session written out", () => {
  const base = {
    phase: "open" as const,
    indices: [{ label: "S&P 500", change: -0.011 }, { label: "Nasdaq", change: -0.0188 }, { label: "Dow", change: -0.0009 }],
    futures: [{ label: "S&P fut", change: -0.0033 }],
    members: Array.from({ length: 120 }, (_, at) => ({ ticker: `T${at}`, sector: at % 2 ? "Energy" : "Technology", change: at % 2 ? 0.01 : -0.02 - at / 10_000, cap: 1e9 * (200 - at) })),
    rates: [{ id: "US10Y", last: 5.085, change: -10 }, { id: "US2Y", last: 4.734, change: -6.8 }, { id: "2s10s", last: 35.1, change: -3.2 }, { id: "DXY", last: 98.5, change: -0.31 }],
    releases: [{ name: "CPI, y/y", actual: "3.7%", consensus: "3.6%", surprise: "above" as const, equity: -0.0068 }],
    results: [{ ticker: "TSM", surprise: 4.2 }, { ticker: "UAL", surprise: -1.1 }],
    fed: { date: "2026-10-28", hike: 0.3, cut: 0 },
    signals: { highs: 12, lows: 4 },
  };
  it("writes every sentence from the numbers it was given", () => {
    const lines = sessionSummary(base);
    expect(lines[0]).toBe("US equities are lower: the S&P 500 −1.10%, the Nasdaq −1.88% and the Dow −0.09%.");
    expect(lines[1]).toBe("Breadth: 60 of 120 S&P 500 constituents advanced (balanced). Energy led (median +1.0%) and Technology lagged (−2.6%).");
    expect(lines).toContain("Treasury yields are lower: the 10-year at 5.08% (−10 bp), the 2-year at 4.73% (−7 bp); the curve flattens to +35 bp 2s10s.");
    expect(lines).toContain("The dollar index falls 0.31% to 98.50.");
    expect(lines).toContain("CPI, y/y came in at 3.7% against 3.6% expected — above the consensus; S&P futures moved −0.68% in the half hour after.");
    expect(lines).toContain("Earnings: 1 of 2 companies reporting today beat EPS consensus; largest surprises: TSM +4.2% and UAL −1.1%.");
    expect(lines).toContain("52-week highs: 12 S&P 500 constituents; 52-week lows: 4 (the last session's and today's).");
    expect(lines).toContain("FOMC Oct 28: fed funds futures imply a 30% probability of a hike.");
  });
  it("leads with the futures before the open, and leaves out what it has no numbers for", () => {
    const lines = sessionSummary({ ...base, phase: "pre", members: [], rates: [], releases: [], results: [], fed: null, signals: null });
    expect(lines).toEqual(["Pre-market, US index futures are lower: S&P fut −0.33%."]);
  });
});

describe("New York time", () => {
  it("names the session", () => {
    expect(phaseAt(new Date("2026-10-15T12:00:00Z"))).toBe("pre");
    expect(phaseAt(new Date("2026-10-15T15:00:00Z"))).toBe("open");
    expect(phaseAt(new Date("2026-10-15T21:00:00Z"))).toBe("after");
    expect(phaseAt(new Date("2026-10-17T15:00:00Z"))).toBe("closed");
  });
});
