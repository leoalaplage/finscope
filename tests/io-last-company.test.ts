import { describe, expect, it } from "vitest";
import { companyReturnPath } from "../lib/io/last-company";

describe("the last company shortcut", () => {
  it("opens a stored company ticker", () => {
    expect(companyReturnPath("aapl")).toBe("/s/AAPL");
    expect(companyReturnPath("BRK.B")).toBe("/s/BRK.B");
  });

  it("falls back to the watchlist without a safe ticker", () => {
    expect(companyReturnPath(null)).toBe("/");
    expect(companyReturnPath("<script>")).toBe("/");
    expect(companyReturnPath("a very long company name")).toBe("/");
  });
});
