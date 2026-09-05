import { describe, expect, it } from "vitest";
import { parseHoldings, writeHoldings } from "../components/io/holdings";

/**
 * A book, typed the way somebody would write it down.
 *
 * The editor parses on every keystroke, so half a line is not an error — it is
 * a line being typed — and everything unreadable is skipped in silence rather
 * than refused with a message under somebody's cursor.
 */
describe("reading a book of holdings", () => {
  it("reads a ticker, a share count and what was paid", () => {
    expect(parseHoldings("AAPL 40 @ 150.25")).toEqual([{ ticker: "AAPL", shares: 40, cost: 150.25 }]);
  });

  it("takes a holding without a price, and states no cost for it", () => {
    expect(parseHoldings("NVDA 15")).toEqual([{ ticker: "NVDA", shares: 15 }]);
  });

  it("accepts the punctuation people actually use", () => {
    expect(parseHoldings("aapl, 40, 150")).toEqual([{ ticker: "AAPL", shares: 40, cost: 150 }]);
    expect(parseHoldings("AAPL 40 $150")).toEqual([{ ticker: "AAPL", shares: 40, cost: 150 }]);
    expect(parseHoldings("BRK.B 3")).toEqual([{ ticker: "BRK.B", shares: 3 }]);
  });

  it("reads a comma inside a number as the thousand it is", () => {
    expect(parseHoldings("WMT 2,000 @ 90")).toEqual([{ ticker: "WMT", shares: 2000, cost: 90 }]);
    // Three fields rather than a grouped number: the comma does not group
    // three digits at a time.
    expect(parseHoldings("AAPL,40,150")).toEqual([{ ticker: "AAPL", shares: 40, cost: 150 }]);
  });

  it("takes fractional shares, which every broker now sells", () => {
    expect(parseHoldings("VOO 1.25 @ 480")).toEqual([{ ticker: "VOO", shares: 1.25, cost: 480 }]);
  });

  it("adds two lots of one company and averages what they cost", () => {
    // 10 at 150 and 5 at 300 is 15 shares at 200, not 5 shares at 300.
    expect(parseHoldings("AAPL 10 @ 150\nAAPL 5 @ 300")).toEqual([{ ticker: "AAPL", shares: 15, cost: 200 }]);
  });

  it("averages over the lots that carry a price, not over all of them", () => {
    // A lot entered without a price must not drag the average towards nothing.
    expect(parseHoldings("AAPL 10 @ 150\nAAPL 10")).toEqual([{ ticker: "AAPL", shares: 20, cost: 150 }]);
  });

  it("skips a line it cannot read rather than refusing the whole book", () => {
    expect(parseHoldings("AAPL 40\nnot a holding\nMSFT\n\nNVDA 2")).toEqual([
      { ticker: "AAPL", shares: 40 },
      { ticker: "NVDA", shares: 2 },
    ]);
  });

  it("writes back what it read, so an editor opens on what is held", () => {
    const book = parseHoldings("AAPL 40 @ 150.25\nNVDA 15");
    expect(writeHoldings(book)).toBe("AAPL 40 @ 150.25\nNVDA 15");
    expect(parseHoldings(writeHoldings(book))).toEqual(book);
  });
});
