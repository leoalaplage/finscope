import { describe, expect, it } from "vitest";
import { betterDirection, movementTone } from "@/lib/metrics";

describe("which way is up", () => {
  it("reads a falling share count as the improvement it is", () => {
    expect(betterDirection("dilutedShares")).toBe("down");
    expect(movementTone("dilutedShares", -0.055)).toBe("positive");
    expect(movementTone("dilutedShares", 0.055)).toBe("negative");
  });

  it("reads a rising margin the ordinary way", () => {
    expect(betterDirection("grossMargin")).toBe("up");
    expect(movementTone("grossMargin", 0.024)).toBe("positive");
    expect(movementTone("grossMargin", -0.024)).toBe("negative");
  });

  it("withholds a verdict on amounts management chose", () => {
    for (const metric of ["shareRepurchases", "dividendsPaid", "capitalExpenditures"]) {
      expect(betterDirection(metric)).toBe("none");
      expect(movementTone(metric, 0.34)).toBe("flat");
      expect(movementTone(metric, -0.34)).toBe("flat");
    }
  });

  it("has no tone for a movement that is absent or nil", () => {
    expect(movementTone("grossMargin", null)).toBe("flat");
    expect(movementTone("grossMargin", 0)).toBe("flat");
    expect(movementTone("grossMargin", Number.NaN)).toBe("flat");
  });

  it("treats a cheaper multiple as the better one", () => {
    expect(movementTone("priceToFreeCashFlow", -0.2)).toBe("positive");
  });
});
