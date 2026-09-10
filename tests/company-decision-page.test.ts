import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the company decision page", () => {
  it("offers a sticky five-part reading path and opens grouped sections", () => {
    const navigation = read("../components/io/CompanyNavigation.tsx");
    const company = read("../components/io/Company.tsx");
    const css = read("../app/io.css");
    for (const label of ["Overview", "Valuation", "Financials", "Ownership", "News"]) {
      expect(navigation).toContain(`label: "${label}"`);
    }
    expect(navigation).toContain('aria-current={active === item.id ? "location" : undefined}');
    expect(company).toContain("<CompanyGroup");
    expect(company).toContain("<details");
    expect(css).toContain(".company-subnav {");
    expect(css).toContain("position: sticky;");
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
