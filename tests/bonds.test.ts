import { describe, expect, it } from "vitest";
import { parseEcbCsv } from "../lib/adapters/ecb";
import { BONDS, bondById } from "../lib/bonds";
import { COMMODITIES, commodityById } from "../lib/commodities";
import { toggleOpen } from "../components/io/QuoteCharts";

/**
 * What governments pay to borrow, on a page that showed shares and metal.
 *
 * Every valuation on this site starts from a risk-free rate. This row is where
 * that rate comes from, and the shape of it — three months against thirty
 * years — is the most watched reading in finance.
 */
describe("the government yields a market page carries", () => {
  it("carries only tenors a daily source actually publishes", () => {
    expect(BONDS.map((bond) => bond.id)).toEqual(["US3M", "US5Y", "US10Y", "US30Y", "EU2Y", "EU10Y"]);
  });

  it("leaves out the United Kingdom rather than filling it with a stale figure", () => {
    /*
     * Not an oversight, and the reason is written into the registry: Yahoo
     * carries no gilt yield under any symbol, the Bank of England's own
     * database serves its interactive page instead of the CSV it advertises,
     * and the ECB's UK series stopped with convergence reporting in 2020. The
     * nearest reachable figure is a monthly OECD average two months behind,
     * and a monthly average sitting unlabelled in a row of daily readings is
     * exactly the substitution this application does not make.
     */
    expect(BONDS.some((bond) => /UK|GB|gilt/i.test(bond.id + bond.label))).toBe(false);
  });

  it("says which readings move during the session and which are struck once a day", () => {
    // The four Treasury yields are quoted like any instrument; the ECB strikes
    // its curve once a business day and publishes it with about a day's lag.
    // A reader who is not told that will read a date that never changes as a
    // broken feed.
    expect(BONDS.filter((bond) => bond.feed.kind === "yahoo").every((bond) => bond.live)).toBe(true);
    expect(BONDS.filter((bond) => bond.feed.kind === "ecb").every((bond) => !bond.live)).toBe(true);
  });

  it("takes the euro area from the bank that publishes it, and never calls it the Bund", () => {
    for (const bond of BONDS) {
      if (bond.feed.kind !== "ecb") continue;
      // The AAA-rated curve: the euro-area risk-free benchmark, which is not
      // any one country's bond and is not named as one.
      expect(bond.feed.key).toMatch(/^B\.U2\.EUR\.4F\.G_N_A\.SV_C_YM\.SR_\d+Y$/);
      expect(bond.label + bond.description).not.toMatch(/bund|german/i);
      expect(bond.description).toMatch(/triple-A/);
    }
  });

  it("gives every line a description, because a tenor alone says nothing", () => {
    for (const bond of BONDS) expect(bond.description.length, bond.label).toBeGreaterThan(20);
  });

  it("finds a line by the id its URL carries, whatever the case", () => {
    expect(bondById("us10y")?.label).toBe("US 10-year");
    expect(bondById("EU10Y")?.feed.kind).toBe("ecb");
    expect(bondById("UK10Y")).toBeNull();
  });

  it("shares no id with the commodities, because one route resolves both", () => {
    // `/api/quote/[id]` looks in both registries. A collision would silently
    // draw one thing under the other's name.
    const clash = BONDS.filter((bond) => commodityById(bond.id));
    expect(clash).toEqual([]);
    expect(COMMODITIES.filter((item) => bondById(item.id))).toEqual([]);
  });
});

/**
 * Reading the ECB's CSV, by column name rather than by position.
 *
 * `detail=dataonly` trims the answer from thirty-nine columns to ten. A
 * positional read would silently shift onto the wrong field the day an
 * eleventh appears — the failure that looks like data rather than like an
 * error.
 */
describe("the ECB yield-curve answer", () => {
  const header = "KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE";
  const row = (date: string, value: string) => `YC.B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y,B,U2,EUR,4F,G_N_A,SV_C_YM,SR_10Y,${date},${value}`;

  it("reads the dates and the values", () => {
    const parsed = parseEcbCsv([header, row("2026-09-08", "3.3784560737"), row("2026-09-09", "3.4265660386")].join("\n"));
    expect(parsed).toEqual([
      { date: "2026-09-08", value: 3.3784560737 },
      { date: "2026-09-09", value: 3.4265660386 },
    ]);
  });

  it("finds the columns wherever they sit", () => {
    const moved = ["OBS_VALUE,TIME_PERIOD,KEY", "3.5,2026-09-09,YC.B"].join("\n");
    expect(parseEcbCsv(moved)).toEqual([{ date: "2026-09-09", value: 3.5 }]);
  });

  it("returns nothing rather than guessing when the columns are not there", () => {
    expect(parseEcbCsv("A,B\n1,2")).toEqual([]);
    expect(parseEcbCsv("")).toEqual([]);
    expect(parseEcbCsv(header)).toEqual([]);
  });

  it("drops a row that carries no observation rather than reading it as nought", () => {
    // A published date with a blank value is a holiday, not a zero yield.
    const parsed = parseEcbCsv([header, row("2026-09-08", ""), row("2026-09-09", "3.42")].join("\n"));
    expect(parsed).toEqual([{ date: "2026-09-09", value: 3.42 }]);
  });

  it("puts the observations in date order whatever order they arrived in", () => {
    // The window's baseline is the first observation and its last point is the
    // last one; an unsorted answer would draw the month backwards.
    const parsed = parseEcbCsv([header, row("2026-09-09", "3.42"), row("2026-09-07", "3.38")].join("\n"));
    expect(parsed.map((observation) => observation.date)).toEqual(["2026-09-07", "2026-09-09"]);
  });
});

/**
 * Which charts are open, which is the whole of the interaction.
 *
 * Three at a time, because the row above is three. A fourth pushes out the
 * oldest rather than refusing: a reader clicking a fourth line wants to see it,
 * and making them close one first is a step that exists only to enforce a limit
 * the layout already implies.
 */
describe("opening a cell into a chart", () => {
  it("opens what was closed and closes what was open", () => {
    expect(toggleOpen([], "BRENT")).toEqual(["BRENT"]);
    expect(toggleOpen(["BRENT"], "BRENT")).toEqual([]);
    expect(toggleOpen(["BRENT"], "GOLD")).toEqual(["BRENT", "GOLD"]);
  });

  it("keeps three, and drops the one opened longest ago", () => {
    const three = toggleOpen(toggleOpen(toggleOpen([], "BRENT"), "WTI"), "GOLD");
    expect(three).toEqual(["BRENT", "WTI", "GOLD"]);
    expect(toggleOpen(three, "COPPER")).toEqual(["WTI", "GOLD", "COPPER"]);
  });

  it("closing a middle one leaves the order of the rest alone", () => {
    expect(toggleOpen(["BRENT", "WTI", "GOLD"], "WTI")).toEqual(["BRENT", "GOLD"]);
  });
});
