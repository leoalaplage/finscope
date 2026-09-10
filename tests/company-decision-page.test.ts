import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the company decision page", () => {
  it("reads top to bottom, with nothing folded away", () => {
    /*
     * A sub-navigation and four collapsible groups were added here, three of
     * them shut on arrival. The statements, the insiders and the newsroom were
     * behind a click a reader had to know to make, and the browser's own find
     * could not see a word of them.
     */
    const company = read("../components/io/Company.tsx");
    expect(company).not.toContain("<CompanyGroup");
    expect(company).not.toContain("<details");
    expect(company).not.toContain("CompanyNavigation");
    for (const section of ["<Statements", "<Insiders", "<Holders", "<CompanyNews"]) {
      expect(company, section).toContain(section);
    }
  });

  it("keeps the reader's own desk after the filings, not among them", () => {
    // A notebook and an export are things done with a company page, not things
    // read on one.
    const company = read("../components/io/Company.tsx");
    expect(company.indexOf("<CompanyNotebook")).toBeGreaterThan(company.indexOf("<CompanyNews"));
    const portfolio = read("../components/io/Portfolio.tsx");
    expect(portfolio.indexOf("<ExportMenu")).toBeGreaterThan(portfolio.indexOf("<PortfolioAnalysis"));
  });

  it("puts the decision summary, filing changes and unified timeline in overview", () => {
    const company = read("../components/io/Company.tsx");
    const overview = read("../components/io/CompanyOverview.tsx");
    expect(company.indexOf("<DecisionSummary")).toBeLessThan(company.indexOf("<PriceSection"));
    expect(company).toContain("<WhatChanged view={view} />");
    expect(company).toContain("<CompanyTimeline");
    for (const dimension of ["Quality", "Health", "Growth", "Valuation", "Coverage"]) {
      expect(overview).toContain(`label: "${dimension}"`);
    }
    expect(overview).toContain('kind: "Insider"');
    expect(overview).toContain('kind: period.fiscalQuarter ? "Results" : "Filing"');
  });
});

describe("Sprint 1 delivery infrastructure", () => {
  it("publishes discovery metadata and record-specific social metadata", () => {
    expect(read("../app/sitemap.ts")).toContain("DEFAULT_WATCHLIST.map");
    expect(read("../app/robots.ts")).toContain("/sitemap.xml");
    expect(read("../app/manifest.ts")).toContain('display: "standalone"');
    const metadata = read("../app/s/[ticker]/page.tsx");
    expect(metadata).toContain("alternates: { canonical:");
    expect(metadata).toContain("images: []");
  });

  it("keeps API caching separate while securing document responses", () => {
    const proxy = read("../proxy.ts");
    expect(proxy).toContain("s-maxage=300");
    expect(proxy).toContain("Content-Security-Policy");
    expect(proxy).toContain("X-Content-Type-Options");
    expect(proxy).toContain('(?!api|_next/static|_next/image');
  });
});
