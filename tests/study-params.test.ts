import { describe, expect, it } from "vitest";
import { cleanParams, isDefault, paramsOf, studyName, withParams } from "@/lib/io/study-params";

describe("study settings", () => {
  it("falls back to the defaults and keeps values inside their bounds", () => {
    expect(paramsOf(undefined, "rsi")).toEqual([14]);
    expect(paramsOf({ rsi: [0] }, "rsi")).toEqual([1]);
    expect(paramsOf({ bollinger: [20.6, 2.345] }, "bollinger")).toEqual([21, 2.3]);
    expect(paramsOf({ ema: [9, Number.NaN] }, "ema")).toEqual([9, 50, 200]);
  });

  it("forgets settings that are back to the default, and unknown studies", () => {
    expect(withParams({}, "rsi", [14])).toEqual({});
    expect(withParams({}, "rsi", [9])).toEqual({ rsi: [9] });
    expect(withParams({ rsi: [9] }, "rsi", null)).toEqual({});
    expect(cleanParams({ rsi: [14], macd: [8, 21, 5], laser: [1] })).toEqual({ macd: [8, 21, 5] });
    expect(isDefault({ macd: [12, 26, 9] }, "macd")).toBe(true);
  });

  it("names a study with its settings", () => {
    expect(studyName("ema", { ema: [9, 21, 50] }, "")).toBe("EMA 9 · 21 · 50");
    expect(studyName("rsi", undefined, "")).toBe("RSI 14");
    expect(studyName("levels", undefined, "Support & resistance")).toBe("Support & resistance");
  });
});
