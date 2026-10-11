import { describe, expect, it } from "vitest";
import { HUE_COUNT, hueOf } from "@/lib/io/hue";

describe("measure colours", () => {
  it("give the opening eight measures distinct fixed places and the share price the page's ink", () => {
    const opening = ["Revenue", "Operating income", "Net income", "Free cash flow", "Operating CF", "FCF / share", "Operating margin", "Diluted shares"];
    expect(new Set(opening.map(hueOf)).size).toBe(8);
    expect(hueOf("Share price")).toBe(0);
  });

  it("place any other measure in the palette, the same way every time", () => {
    const hue = hueOf("Gross margin");
    expect(hue).toBeGreaterThanOrEqual(1);
    expect(hue).toBeLessThanOrEqual(HUE_COUNT);
    expect(hueOf(" gross MARGIN ")).toBe(hue);
  });
});
