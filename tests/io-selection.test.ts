import { describe, expect, it } from "vitest";
import { axesFor, toggleMetric } from "../components/io/selection";

/** A stand-in registry: what unit each measure is stated in. */
const UNITS: Record<string, string> = {
  revenue: "currency",
  netIncome: "currency",
  freeCashFlow: "currency",
  operatingMargin: "percent",
  grossMargin: "percent",
  fcfPerShare: "perShare",
};
const unitOf = (key: string) => UNITS[key] ?? null;

describe("what the big chart is showing", () => {
  it("adds and removes, and a second click on the same measure takes it off", () => {
    expect(toggleMetric([], "revenue", unitOf)).toEqual(["revenue"]);
    expect(toggleMetric(["revenue"], "operatingMargin", unitOf)).toEqual(["revenue", "operatingMargin"]);
    expect(toggleMetric(["revenue", "operatingMargin"], "revenue", unitOf)).toEqual(["operatingMargin"]);
  });

  it("carries three measures at most, and the oldest makes room", () => {
    // A fourth line on one frame stops being a comparison and starts being a
    // texture, and a click that does nothing is worse than one that rolls.
    const three = ["revenue", "netIncome", "freeCashFlow"];
    expect(toggleMetric(three, "grossMargin", unitOf)).toEqual(["netIncome", "freeCashFlow", "grossMargin"]);
  });

  it("never asks for a third axis", () => {
    /*
     * A chart can carry two scales and no more. A third would place its zero
     * and its span wherever the code happened to, and every crossing point on
     * the picture would be an artefact of that rather than a fact.
     */
    const mixed = ["revenue", "operatingMargin"];
    expect(toggleMetric(mixed, "fcfPerShare", unitOf)).toEqual(["operatingMargin", "fcfPerShare"]);
    const full = ["revenue", "netIncome", "operatingMargin"];
    const next = toggleMetric(full, "fcfPerShare", unitOf);
    expect(new Set(next.map(unitOf)).size).toBeLessThanOrEqual(2);
    expect(next).toContain("fcfPerShare");
  });

  it("puts measures sharing a unit on the same side", () => {
    const { units, axisOf } = axesFor(["revenue", "netIncome", "operatingMargin"], unitOf);
    expect(units).toEqual(["currency", "percent"]);
    expect(axisOf("revenue")).toBe(0);
    expect(axisOf("netIncome")).toBe(0);
    expect(axisOf("operatingMargin")).toBe(1);
  });

  it("uses one axis when one unit is all there is", () => {
    const { units, axisOf } = axesFor(["revenue", "netIncome"], unitOf);
    expect(units).toEqual(["currency"]);
    expect(axisOf("netIncome")).toBe(0);
  });
});
