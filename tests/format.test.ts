import { describe, expect, it } from "vitest";
import { change, money, multiple, NO_VALUE, percent, perShare, points, readableDate, shares, tone } from "../lib/format";

/*
 * One way to write a number.
 *
 * Ten components were building their own formatters, so the same figure read
 * `$3.67T` on one screen and `3671.2` on another. These are the rules the whole
 * interface now shares.
 */
describe("financial formatting", () => {
  it("writes money at the scale a reader thinks in", () => {
    expect(money(3_671_000_000_000)).toBe("$3.67T");
    expect(money(331_800_000_000)).toBe("$331.8B");
    expect(money(4_114_000_000)).toBe("$4.11B");
    expect(money(24_350_000_000)).toBe("$24.35B");
    // The trailing zero stays: a column of $356.0M and $331.8B keeps one
    // width, and a table of figures is read down rather than one at a time.
    expect(money(356_000_000)).toBe("$356.0M");
    expect(money(-42_800_000_000)).toBe("−$42.80B");
    expect(money(32_700_000_000, "EUR")).toBe("€32.70B");
  });

  it("keeps a percentage readable at both ends of its range", () => {
    expect(percent(.004)).toBe("0.4%");
    expect(percent(3.4)).toBe("340%");
    expect(percent(.246)).toBe("24.6%");
    expect(percent(-.126)).toBe("−12.6%");
    expect(change(.132)).toBe("+13.2%");
  });

  it("uses one character for a figure that is not there", () => {
    for (const written of [money(null), percent(undefined), perShare(Number.NaN), multiple(null), shares(null), readableDate(null)]) {
      expect(written).toBe(NO_VALUE);
    }
  });

  it("writes the rest the way the screens ask for them", () => {
    expect(perShare(12.453)).toBe("$12.45");
    expect(multiple(24.34)).toBe("24.3×");
    expect(multiple(2.181, { leading: true })).toBe("×2.18");
    expect(points(.062)).toBe("+6.2 pp");
    expect(shares(14_773_260_000)).toBe("14.8B");
    expect(readableDate("2025-09-27")).toBe("27 Sep 2025");
  });

  it("says which way a figure leans, for the one colour rule", () => {
    expect(tone(.1)).toBe("positive");
    expect(tone(-.1)).toBe("negative");
    expect(tone(0)).toBe("flat");
    expect(tone(null)).toBe("flat");
  });
});
