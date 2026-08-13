import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooPrices, matchHistoricalSession, resolveYahooTicker } from "../lib/adapters/yahoo";
import { cagrBetweenDates } from "../lib/finance";

const sessions = [
  { date: "2025-09-25", close: 250, adjustedClose: 249 },
  { date: "2025-09-26", close: 255, adjustedClose: 254 },
  { date: "2025-09-29", close: 257, adjustedClose: 256 },
];

describe("Yahoo historical session matching", () => {
  afterEach(()=>vi.restoreAllMocks());
  it("uses Friday for a Saturday fiscal end", () => {
    const result = matchHistoricalSession(sessions, "2025-09-27");
    expect(result?.session.date).toBe("2025-09-26");
    expect(result?.fallback).toBe("previous trading session");
    expect(result?.type).toBe("adjusted close");
    expect(result?.price).toBe(254);
  });

  it("uses the previous session for Sunday and exchange holidays", () => {
    expect(matchHistoricalSession(sessions, "2025-09-28")?.session.date).toBe("2025-09-26");
    expect(matchHistoricalSession(sessions, "2025-09-30", { previousDays: 7 })?.session.date).toBe("2025-09-29");
  });

  it("uses a clearly identified next-session fallback only within its window", () => {
    const result = matchHistoricalSession([{ date: "2025-10-02", close: 12, adjustedClose: null }], "2025-10-01");
    expect(result?.fallback).toBe("next trading session");
    expect(result?.type).toBe("close");
  });

  it("returns unavailable when the configured window has no session", () => {
    expect(matchHistoricalSession(sessions, "2025-10-20")).toBeNull();
  });

  it("resolves ticker history and prefers split-adjusted prices", () => {
    expect(resolveYahooTicker({ ticker: "META", tickerHistory: [{ ticker: "FB", to: "2022-06-08" }] }, "2021-12-31")).toBe("FB");
    expect(matchHistoricalSession([{ date: "2020-08-31", close: 500, adjustedClose: 125 }], "2020-08-31")?.price).toBe(125);
  });

  it("loads a complete multi-period history in one provider request",async()=>{
    const provider={chart:{result:[{meta:{currency:"USD",symbol:"TEST"},timestamp:[Date.parse("2020-12-31")/1000,Date.parse("2025-12-31")/1000],indicators:{quote:[{close:[10,20]}],adjclose:[{adjclose:[9,19]}]}}],error:null}};
    const request=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify(provider),{status:200,headers:{"content-type":"application/json"}}));
    const company={name:"Test",ticker:"TEST",yahooTicker:"TEST",cik:"1",exchange:"X",currency:"USD",sector:"",description:""};
    const points=await fetchYahooPrices(company,["2020-12-31","2025-12-31"]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(points.map((item)=>item.point?.close)).toEqual([9,19]);
    expect(points.every((item)=>item.point?.ticker==="TEST")).toBe(true);
  });
});

describe("date-aware CAGR", () => {
  it("uses actual dates rather than nominal year labels", () => {
    const result = cagrBetweenDates(100, 121, "2023-01-01", "2025-01-01");
    expect(result.years).toBeCloseTo(2, 2);
    expect(result.value).toBeCloseTo(.1, 3);
  });

  it("explains non-meaningful endpoints", () => {
    expect(cagrBetweenDates(0, 10, "2020-01-01", "2025-01-01").reason).toContain("zero");
    expect(cagrBetweenDates(-10, 10, "2020-01-01", "2025-01-01").reason).toContain("signs");
    expect(cagrBetweenDates(null, 10, "2020-01-01", "2025-01-01").reason).toContain("Insufficient");
  });
});
