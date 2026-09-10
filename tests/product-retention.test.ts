import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCsv, buildPdf, buildXlsx } from "../components/io/ExportMenu";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shareable research workflows", () => {
  it("keeps the two settings in the address, and asks the question backwards", () => {
    const source = read("../components/io/Dcf.tsx");
    // A reading can be sent as a link: the company, the return required and
    // the growth assumed.
    expect(source).toContain('url.searchParams.set("s", ticker)');
    expect(source).toContain('url.searchParams.set("r"');
    expect(source).toContain('url.searchParams.set("g"');
    /*
     * The page opens answered. What growth would justify today's price is
     * arithmetic on the price, so it takes nothing from the reader — unlike a
     * forward model, which answers whatever it is fed.
     */
    expect(source).toContain("model?.asks.kind === \"solved\" ? model.asks.rate : null");
    expect(source).toContain("The price is asking for");
    // Three named cases, a strip of statistics and a grid of margins are gone.
    expect(source).not.toContain("caseValues");
    expect(source).not.toContain("Bear");
    expect(source).not.toContain("dcf-matrix");
  });

  it("stores named watchlists locally, and keeps no notebook", () => {
    expect(read("../components/io/watchlist.ts")).toContain("WATCHLISTS_KEY");
    expect(read("../components/io/WatchlistEditor.tsx")).toContain("New list");
    // A notebook of thesis, risks and catalysts sat at the foot of every
    // company page. It is a place to write, on a site for reading filings.
    expect(read("../components/io/Company.tsx")).not.toContain("CompanyNotebook");
    /*
     * The screener saves nothing. Saved views were stored beside a minimum
     * score, a maximum alert count and a sector box, and all four are gone:
     * the list is the reader's own watchlist, and hiding part of it is the one
     * thing a ranking of twenty-seven companies must not do.
     */
    const screener = read("../components/io/Screener.tsx");
    expect(screener).not.toContain("SAVED_SCREENS_KEY");
    expect(screener).not.toContain("filterRows");
    expect(screener).not.toContain("ExportMenu");
  });

  it("makes an empty portfolio decision-oriented", () => {
    const portfolio = read("../components/io/Portfolio.tsx");
    expect(portfolio).toContain("Try an example");
    expect(portfolio).toContain("Look-through cash");
  });
});

describe("source-preserving exports", () => {
  const rows = [{ ticker: "AAPL", score: 87.5, period: "FY 2026" }];
  const provenance = ["SEC EDGAR · https://www.sec.gov/example"];

  it("writes provenance and values to CSV", () => {
    const output = buildCsv(rows, provenance);
    expect(output).toContain("SEC EDGAR");
    expect(output).toContain("AAPL,87.5,FY 2026");
  });

  it("creates genuine XLSX and PDF file signatures", () => {
    const spreadsheet = buildXlsx(rows, provenance);
    expect([...spreadsheet.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(spreadsheet)).toContain("xl/worksheets/sheet1.xml");
    expect(new TextDecoder().decode(buildPdf(rows, provenance)).startsWith("%PDF-1.4")).toBe(true);
  });
});
