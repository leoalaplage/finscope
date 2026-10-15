import { describe, expect, it } from "vitest";
import { canonicalRedirect, terminalRedirect } from "../lib/terminal-switch";

describe("the former site leads to the terminal", () => {
  it("sends each page to its terminal twin", () => {
    expect(terminalRedirect("/")).toBe("/t");
    expect(terminalRedirect("/company")).toBe("/t");
    expect(terminalRedirect("/research")).toBe("/t");
    expect(terminalRedirect("/s/AAPL")).toBe("/t/s/AAPL");
    expect(terminalRedirect("/screener")).toBe("/t/screener");
    expect(terminalRedirect("/portfolio")).toBe("/t/portfolio");
    expect(terminalRedirect("/settings")).toBe("/t/settings");
    expect(terminalRedirect("/account")).toBe("/t/account");
  });

  it("leaves the terminal, the API, the assets and the status page alone", () => {
    for (const path of ["/t", "/t/s/AAPL", "/t/account", "/api/company/AAPL", "/_next/static/x.js", "/status", "/og.png", "/robots.txt", "/qs/"]) expect(terminalRedirect(path)).toBeNull();
  });
});

describe("tenqay.com is the address", () => {
  it("sends the Worker's own address and www there, pages only", () => {
    expect(canonicalRedirect(new URL("https://finscope-financial-research.leoalaplage.workers.dev/s/AAPL?x=1"))).toBe("https://tenqay.com/t/s/AAPL?x=1");
    expect(canonicalRedirect(new URL("https://www.tenqay.com/t/market"))).toBe("https://tenqay.com/t/market");
    expect(canonicalRedirect(new URL("https://finscope-financial-research.leoalaplage.workers.dev/api/company/AAPL"))).toBeNull();
    expect(canonicalRedirect(new URL("https://tenqay.com/t/s/DAL"))).toBeNull();
    expect(canonicalRedirect(new URL("https://tenqay.com/"))).toBe("https://tenqay.com/t");
  });
});
