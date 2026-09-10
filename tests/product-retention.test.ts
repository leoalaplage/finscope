import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCsv, buildPdf, buildXlsx } from "../components/io/ExportMenu";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shareable research workflows", () => {
  it("keeps the complete DCF scenario in the address", () => {
    const source = read("../components/io/Dcf.tsx");
    expect(source).toContain('url.searchParams.set("r"');
    expect(source).toContain('url.searchParams.set("g"');
    expect(source).toContain('url.searchParams.set("scenario"');
    expect(source).toContain("Copy scenario");
    for (const name of ["Bear", "Base", "Bull"]) expect(source).toContain(`"${name}"`);
  });

  it("stores named watchlists, company notes, screens and alert state locally", () => {
    expect(read("../components/io/watchlist.ts")).toContain("WATCHLISTS_KEY");
    expect(read("../components/io/WatchlistEditor.tsx")).toContain("New list");
    expect(read("../components/io/CompanyNotebook.tsx")).toContain("Research notebook");
    expect(read("../components/io/Screener.tsx")).toContain("SAVED_SCREENS_KEY");
    const alerts = read("../components/io/AlertsCenter.tsx");
    for (const kind of ["filing", "insider", "valuation", "grade"]) expect(alerts).toContain(`"${kind}"`);
  });

  it("makes the home and empty portfolio decision-oriented", () => {
    const home = read("../components/io/HomeWatchlist.tsx");
    expect(home).toContain("Recently viewed");
    expect(home).toContain("changePercent");
    expect(home).toContain("valuationStars");
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
