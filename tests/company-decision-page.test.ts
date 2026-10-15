import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the company page", () => {
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
    for (const section of ["<Statements", "<Insiders", "<Holders"]) {
      expect(company, section).toContain(section);
    }
  });

  it("keeps the portfolio's export after the book, not on its masthead", () => {
    // Taking the book away is something done after reading it.
    const portfolio = read("../components/io/Portfolio.tsx");
    expect(portfolio.indexOf("<ExportMenu")).toBeGreaterThan(portfolio.indexOf("<PortfolioAnalysis"));
  });
});

describe("Sprint 1 delivery infrastructure", () => {
  it("publishes discovery metadata and record-specific social metadata", () => {
    // The terminal is FinScope: its screens and the S&P 500's company pages are listed, the reader's own screens are not.
    const sitemap = read("../app/sitemap.ts");
    expect(sitemap).toContain("UNIVERSE.map");
    expect(sitemap).toContain("/t/s/");
    expect(sitemap).not.toContain("/t/account");
    expect(read("../app/t/s/[ticker]/page.tsx")).toContain("canonical: `/t/s/");
    expect(read("../app/t/s/[ticker]/page.tsx")).not.toContain("index: false");
    expect(read("../app/t/account/page.tsx")).toContain("index: false");
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
