import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCsv, buildPdf, buildXlsx } from "../components/io/ExportMenu";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("shareable research workflows", () => {
  it("keeps the complete DCF scenario in the address, and names what a case sets", () => {
    const source = read("../components/io/Dcf.tsx");
    expect(source).toContain('url.searchParams.set("r"');
    expect(source).toContain('url.searchParams.set("g"');
    expect(source).toContain('url.searchParams.set("scenario"');
    for (const name of ["Bear", "Base", "Bull"]) expect(source).toContain(`"${name}"`);
    /*
     * The three cases sat in a strip at the top and moved two controls three
     * sections below without saying so. One definition now feeds both the
     * button's own label and what pressing it does, so the two cannot drift.
     */
    expect(source).toContain("function caseValues(");
    expect(source).toContain("caseValues(name, record?.rate ?? near?.rate ?? custom)");
    expect(source).toContain("{percent(values.growth, 1)} growth · {percent(values.required, 0)} required");
    // Nothing copies a link out of the page any more.
    expect(source).not.toContain("Copy scenario");
    expect(source).not.toContain("navigator.clipboard");
  });

  it("stores named watchlists and company notes locally", () => {
    expect(read("../components/io/watchlist.ts")).toContain("WATCHLISTS_KEY");
    expect(read("../components/io/WatchlistEditor.tsx")).toContain("New list");
    expect(read("../components/io/CompanyNotebook.tsx")).toContain("Research notebook");
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
