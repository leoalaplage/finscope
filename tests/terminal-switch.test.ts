import { describe, expect, it } from "vitest";
import { terminalRedirect } from "../lib/terminal-switch";

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
