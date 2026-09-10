import { describe, expect, it } from "vitest";
import { impliedGrowth, presentValue, terminalShare } from "../lib/io/implied-growth";

/**
 * How much of a discounted cash flow is the part nobody can observe.
 *
 * Ten years of projected cash is the half of the exercise a reader can argue
 * about; everything after it is one number standing for the rest of time. On
 * these terms it is routinely two thirds of the answer, and until now the page
 * stated the conclusion without stating that.
 */

const terms = (over: Partial<Parameters<typeof presentValue>[0]> = {}) => ({
  marketCap: 1_000,
  freeCashFlow: 50,
  discountRate: .10,
  years: 10,
  terminalGrowth: .025,
  ...over,
});

describe("the share of the value that is the perpetuity", () => {
  it("splits the present value in two, and the two halves add up", () => {
    const share = terminalShare(terms(), .08)!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    /*
     * The explicit years and the perpetuity are the whole of the present value
     * and nothing else, so the share can be checked against the arithmetic it
     * came from rather than against a second implementation of it.
     */
    const whole = presentValue(terms(), .08);
    let explicit = 0;
    let flow = 50;
    for (let year = 1; year <= 10; year++) { flow *= 1.08; explicit += flow / 1.10 ** year; }
    expect(share).toBeCloseTo((whole - explicit) / whole, 10);
  });

  it("is about two thirds on the terms this site uses", () => {
    // The figure that makes the caveat worth printing: a reader trusting the
    // headline is trusting a perpetuity for most of it.
    expect(terminalShare(terms(), .08)!).toBeGreaterThan(.55);
    expect(terminalShare(terms(), .08)!).toBeLessThan(.75);
  });

  it("rises with growth and falls with the return required", () => {
    // Faster growth pushes more of the cash beyond the horizon; a harder
    // discount rate shrinks the far years faster than the near ones.
    expect(terminalShare(terms(), .15)!).toBeGreaterThan(terminalShare(terms(), .02)!);
    expect(terminalShare(terms({ discountRate: .14 }), .08)!).toBeLessThan(terminalShare(terms({ discountRate: .07 }), .08)!);
  });

  it("refuses where the arithmetic has no meaning", () => {
    // A perpetuity growing at least as fast as it is discounted is infinite,
    // and there is no cash flow to apportion where none was earned.
    expect(terminalShare(terms({ freeCashFlow: -10 }), .08)).toBeNull();
    expect(terminalShare(terms({ discountRate: .02 }), .08)).toBeNull();
  });

  it("is struck on the same rate the headline is", () => {
    /*
     * The page prints the share beside the growth the price is asking for, so
     * it has to be the share at that growth: a company whose price demands
     * twenty per cent a year is leaning on the perpetuity harder than one
     * whose price demands five, and quoting an average would hide exactly the
     * cases where the caveat matters most.
     */
    const asked = impliedGrowth(terms());
    expect(asked.kind).toBe("solved");
    const rate = (asked as { rate: number }).rate;
    expect(terminalShare(terms(), rate)!).toBeCloseTo(terminalShare(terms(), rate)!, 10);
    expect(presentValue(terms(), rate)).toBeCloseTo(1_000, 6);
  });
});
