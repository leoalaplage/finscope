import { describe, expect, it } from "vitest";
import { COMMODITIES } from "../lib/commodities";

/**
 * The other asset class, on a page that showed one.
 *
 * Three equity indices and nothing else is one market pretending to be the
 * market. What an oil major earns, what a miner earns, what a factory pays and
 * what next month's inflation print will read all sit in these six lines and
 * in none of the three above them.
 */
describe("the commodities a market page carries", () => {
  it("names the benchmark contract for each thing, not every contract", () => {
    // Chosen the way the index list was: one symbol per question a reader has.
    expect(COMMODITIES.map((item) => item.id)).toEqual(["BRENT", "WTI", "GAS", "GOLD", "SILVER", "COPPER"]);
    // Brent prices most of the world's oil and West Texas prices North
    // America's; the gap between the two is itself a reading, so both are here.
    expect(COMMODITIES.filter((item) => item.group === "energy")).toHaveLength(3);
    expect(COMMODITIES.filter((item) => item.group === "metal")).toHaveLength(3);
  });

  it("says what the quoted price is a price of", () => {
    /*
     * Never obvious and never the same: oil is a barrel, gold an ounce, copper
     * a pound and gas a million British thermal units. A number with no unit
     * beside it is the reason nobody can say whether gas at three dollars is
     * cheap.
     */
    for (const item of COMMODITIES) {
      expect(item.unit, item.label).toMatch(/^an? /);
    }
    expect(COMMODITIES.find((item) => item.id === "COPPER")!.unit).toBe("a pound");
    expect(COMMODITIES.find((item) => item.id === "GAS")!.unit).toBe("a million BTU");
  });

  it("quotes each to the precision its contract trades at", () => {
    /*
     * A property of the quote, not of the size of the number. Reading it off
     * the magnitude put copper at $6.520 a pound and gas at $2.84 — a trailing
     * nought on one and a missing digit on the other.
     */
    expect(COMMODITIES.find((item) => item.id === "COPPER")!.places).toBe(2);
    expect(COMMODITIES.find((item) => item.id === "GAS")!.places).toBe(3);
    expect(COMMODITIES.find((item) => item.id === "GOLD")!.places).toBe(2);
  });

  it("reads a continuous front-month symbol for every one", () => {
    // "The oil price" means the front month. A contract expires and the series
    // rolls; the continuous symbol handles that, and the page names the
    // contract it actually read so a roll is never mistaken for a move.
    for (const item of COMMODITIES) {
      expect(item.symbol, item.label).toMatch(/=F$/);
    }
  });
});
