import { describe, expect, it } from "vitest";
import { largest, listedFrom } from "../lib/listed-universe";
import { retryDue } from "../lib/universe-all";
import { compactTable, expandTable } from "../lib/universe-compact";
import { compactFeed, expandFeed, type ScreenerFeed } from "../lib/screener-feed";
import type { UniverseTable } from "../lib/universe-build";

const fields = ["cik", "name", "ticker", "exchange"];

describe("the SEC's list of listed companies", () => {
  it("keeps one common stock a filer on the NYSE or Nasdaq, and no fund, warrant, unit or OTC listing", () => {
    const table = { fields, data: [
      [320193, "Apple Inc.", "AAPL", "Nasdaq"],
      [1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
      [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
      [70858, "BANK OF AMERICA CORP /DE/", "BAC", "NYSE"],
      [70858, "BANK OF AMERICA CORP /DE/", "BAC-PK", "NYSE"],
      [1000001, "Some Acquisition Corp", "SACQ", "Nasdaq"],
      [1000002, "Warrant Co", "WRNTW", "Nasdaq"],
      [1000003, "Pink Sheet Inc", "PINK", "OTC"],
      [1000004, "Vanguard Index Funds", "VOO", "NYSE"],
      [1000005, "Berkshire Hathaway Inc", "BRK-B", "NYSE"],
    ] };
    const listed = listedFrom(table, new Set([1000004]));
    expect(listed.map((member) => member.ticker)).toEqual(["AAPL", "BAC", "BRK.B", "GOOG"]);
    expect(listed.find((member) => member.ticker === "AAPL")!.cik).toBe("0000320193");
  });

  it("takes the largest by market value, leaving out the unpriced", () => {
    const rows = [{ ticker: "A" }, { ticker: "B" }, { ticker: "C" }, { ticker: "D" }];
    const value: Record<string, number | null> = { A: 10, B: null, C: 30, D: 20 };
    expect([...largest(rows, (row) => value[row.ticker], 2)]).toEqual(["C", "D"]);
  });
});

describe("a company that cannot be built", () => {
  it("is asked again after a day, then two, four… a month at most", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    expect(retryDue(undefined, now)).toBe(true);
    expect(retryDue({ at: ago(0.5), tries: 1 }, now)).toBe(false);
    expect(retryDue({ at: ago(1), tries: 1 }, now)).toBe(true);
    expect(retryDue({ at: ago(3), tries: 3 }, now)).toBe(false);
    expect(retryDue({ at: ago(4), tries: 3 }, now)).toBe(true);
    expect(retryDue({ at: ago(30), tries: 12 }, now)).toBe(true);
  });
});

describe("the tables in columns", () => {
  it("give back the same universe table", () => {
    const table: UniverseTable = {
      name: "All US", asOf: "2026-10-01", builtAt: "2026-10-14T00:00:00.000Z", members: 2, pending: [],
      rows: [
        { ticker: "AAA", name: "Aaa", qs: { Sector: "Software", "Gross Margin": 0.6123456789 } as never, qsPrice: { currency: "USD" } as never, retrievedAt: "2026-10-10", periodLabel: "FY2025", read: "" },
        { ticker: "BBB", name: "Bbb", qs: { Sector: "Banking" } as never, qsPrice: { currency: "USD" } as never, retrievedAt: "2026-10-11", read: "" },
      ],
      prices: { AAA: { price: 12.5, currency: "USD", asOf: "2026-10-13", changePercent: 1.2 } },
    };
    const back = expandTable(JSON.parse(JSON.stringify(compactTable(table))));
    expect(back.rows[0]).toMatchObject({ ticker: "AAA", periodLabel: "FY2025", qs: { Sector: "Software", "Gross Margin": 0.612346 } });
    expect(back.rows[1].qs).toEqual({ Sector: "Banking", "Gross Margin": null });
    expect(back.prices).toEqual(table.prices);
  });

  it("give back the same screener feed", () => {
    const feed: ScreenerFeed = {
      name: "US 1000", asOf: "2026-10-01", members: 2, building: true, refreshedAt: "2026-10-14T00:00:00.000Z",
      coverage: { fundamental: 1, price: 1, consensus: 0, technical: 0 },
      rows: [
        { ticker: "AAA", name: "Aaa", sector: "Software", currency: "USD", values: { "Market Cap": 1e9 }, previous: {}, dates: { fundamental: "2026-10-10", price: "2026-10-13", consensus: null, technical: null }, period: "FY2025", epsBasis: null, sharesBasis: "cover", reasons: { consensus: "No consensus." } },
        { ticker: "BBB", name: "Bbb", sector: null, currency: null, values: {}, previous: {}, dates: { fundamental: null, price: null, consensus: null, technical: null }, period: null, epsBasis: null, sharesBasis: null, reasons: { fundamental: "Not built.", consensus: "No consensus." } },
      ],
    };
    const back = expandFeed(JSON.parse(JSON.stringify(compactFeed(feed))));
    expect(back.rows[0].values["Market Cap"]).toBe(1e9);
    expect(back.rows[0].reasons).toEqual(feed.rows[0].reasons);
    expect(back.rows[1].reasons).toEqual(feed.rows[1].reasons);
    expect(back.rows[1].dates).toEqual(feed.rows[1].dates);
    expect(back.coverage).toEqual(feed.coverage);
    // An uncompressed feed passes through untouched.
    expect(expandFeed(feed)).toBe(feed);
  });
});
