import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRiskFree, loadCostOfEquity } from "../components/io/use-cost-of-equity";

const asOf = new Date("2026-10-17T12:00:00Z");
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
const curve = (date = "2026-10-16") => ({ now: { date, points: [{ years: 10, value: 4.3 }] } });
const history = (factor: number, weeks = 130) => {
  let close = 100;
  return { bars: Array.from({ length: weeks + 1 }, (_, index) => {
    if (index) close *= 1 + (Math.sin(index / 3) * .02 + .001) * factor;
    return { date: new Date(asOf.getTime() - (weeks - index) * 7 * 86_400_000 - 86_400_000).toISOString().slice(0, 10), adjustedClose: close };
  }) };
};
afterEach(() => vi.unstubAllGlobals());

describe("cost of equity data loading", () => {
  it("uses the dedicated Treasury curve without waiting for unrelated macro providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(curve()));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRiskFree(undefined, asOf)).toEqual({ rate: .043, date: "2026-10-16", source: "U.S. Treasury · yield curve" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/yield-curve");
  });

  it("falls back to macro and preserves the Treasury observation date", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({}, false))
      .mockResolvedValueOnce(response({ indicators: [{ id: "treasury-10y", date: "2026-10-15", value: 4.2 }] })));
    expect(await fetchRiskFree(undefined, asOf)).toEqual({ rate: .042, date: "2026-10-15", source: "U.S. Treasury · macro" });
  });

  it("rejects stale or future Treasury observations", async () => {
    for (const date of ["2026-09-01", "2026-10-18"]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(curve(date))));
      expect(await fetchRiskFree(undefined, asOf)).toBeNull();
    }
  });

  const install = (company: unknown, treasury = true, premium = true) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/market/AVGO")) return response(company);
      if (url.startsWith("/api/market/SPY")) return response(history(1));
      if (url === "/api/yield-curve") return response(treasury ? curve() : {}, treasury);
      if (url.startsWith("/api/market-premium")) return response({ premium: .045, fallback: false }, premium);
      return response({}, false);
    }));
  };

  it("loads a measured CAPM estimate using matched weekly adjusted returns", async () => {
    install(history(1.5));
    const answer = await loadCostOfEquity("AVGO", undefined, asOf);
    expect(answer.value!.rawBeta).toBeCloseTo(1.5);
    expect(answer.value!.rate).toBeCloseTo(.043 + (4 / 3) * .045);
    expect(answer.observations).toBe(130);
    expect(answer.premiumSource).toBe("index-implied");
    expect(answer.unavailableReason).toBeNull();
  });

  it("keeps available Treasury data when company history is insufficient", async () => {
    install(history(1.5, 40));
    const answer = await loadCostOfEquity("AVGO", undefined, asOf);
    expect(answer.value).toBeNull();
    expect(answer.riskFree).toBe(.043);
    expect(answer.unavailableReason).toBe("insufficient-history");
    expect(answer.observations).toBe(40);
  });

  it("identifies a missing Treasury separately from missing beta", async () => {
    install(history(1.5), false);
    const answer = await loadCostOfEquity("AVGO", undefined, asOf);
    expect(answer.value).toBeNull();
    expect(answer.unavailableReason).toBe("risk-free-unavailable");
    expect(answer.observations).toBe(130);
  });

  it("uses and identifies the long-run premium assumption if its endpoint fails", async () => {
    install(history(1.5), true, false);
    const answer = await loadCostOfEquity("AVGO", undefined, asOf);
    expect(answer.value!.premium).toBe(.05);
    expect(answer.premiumSource).toBe("long-run-assumption");
  });
});
