import { describe, expect, it } from "vitest";
import { hrefFor, parseCommand, suggestFunctions, terminalHref } from "@/lib/term/command";
import { marketState, newYorkTime } from "@/lib/term/market-clock";

describe("parseCommand", () => {
  it("opens a security on its own", () => {
    expect(parseCommand("aapl")).toEqual({ kind: "company", ticker: "AAPL", fn: "DES" });
  });

  it("reads security then function, with the words terminals put between them", () => {
    expect(parseCommand("AAPL US GP <GO>")).toEqual({ kind: "company", ticker: "AAPL", fn: "GP" });
    expect(parseCommand("msft equity fa")).toEqual({ kind: "company", ticker: "MSFT", fn: "FA" });
  });

  it("reads function then security", () => {
    expect(parseCommand("GP NVDA")).toEqual({ kind: "company", ticker: "NVDA", fn: "GP" });
  });

  it("applies a lone function to the company on screen", () => {
    expect(parseCommand("fa", "AAPL")).toEqual({ kind: "company", ticker: "AAPL", fn: "FA" });
    expect(parseCommand("fa")).toEqual({ kind: "needs-ticker", fn: "FA" });
  });

  it("knows Bloomberg's spellings", () => {
    expect(parseCommand("AAPL HP")).toEqual({ kind: "company", ticker: "AAPL", fn: "GP" });
    expect(parseCommand("EQS")).toEqual({ kind: "global", fn: "SCRN" });
    expect(parseCommand("?")).toEqual({ kind: "global", fn: "HELP" });
  });

  it("opens the launchpad's panels by their codes", () => {
    expect(parseCommand("evts")).toEqual({ kind: "global", fn: "HOME", panel: "evts" });
    expect(hrefFor(parseCommand("IMAP"))).toBe("/t#imap");
  });

  it("keeps dotted share classes", () => {
    expect(parseCommand("BRK.B DES")).toEqual({ kind: "company", ticker: "BRK.B", fn: "DES" });
  });

  it("treats a company name as a search", () => {
    expect(parseCommand("bank of america")).toEqual({ kind: "search", query: "bank of america" });
    expect(parseCommand("coca cola")).toEqual({ kind: "search", query: "coca cola" });
  });

  it("is empty when nothing was typed", () => {
    expect(parseCommand("   ")).toEqual({ kind: "empty" });
    expect(parseCommand("<GO>")).toEqual({ kind: "empty" });
  });
});

describe("hrefFor", () => {
  it("sends panels to the terminal company page and screens to their own pages", () => {
    expect(hrefFor({ kind: "company", ticker: "AAPL", fn: "DES" })).toBe("/t/s/AAPL");
    expect(hrefFor({ kind: "company", ticker: "AAPL", fn: "HDS" })).toBe("/t/s/AAPL#hds");
    expect(hrefFor({ kind: "company", ticker: "AAPL", fn: "DCF" })).toBe("/t/dcf?s=AAPL");
    expect(hrefFor({ kind: "company", ticker: "BRK.B", fn: "COMP" })).toBe("/t/compare?s=BRK.B");
    expect(hrefFor({ kind: "global", fn: "SCRN" })).toBe("/t/screener");
    expect(hrefFor({ kind: "global", fn: "HELP" })).toBeNull();
  });
});

describe("suggestFunctions", () => {
  it("offers a company's functions once the security is typed", () => {
    expect(suggestFunctions("AAPL G", null).map((s) => s.command)).toEqual(["AAPL GP"]);
    expect(suggestFunctions("AAPL ", null)).toHaveLength(10);
  });

  it("offers global functions, and the on-screen company's, for a partial word", () => {
    const codes = suggestFunctions("d", "MSFT").map((s) => s.command);
    expect(codes).toEqual(["MSFT DES", "MSFT DCF"]);
    expect(suggestFunctions("sc", null).map((s) => s.code)).toEqual(["SCRN"]);
  });
});

describe("marketState", () => {
  // 10 Oct 2026 is a Saturday; 9 Oct a Friday. New York is on EDT (UTC−4).
  it("follows the regular session and extended hours", () => {
    expect(marketState(new Date("2026-10-09T12:00:00Z"))).toBe("PRE");
    expect(marketState(new Date("2026-10-09T13:30:00Z"))).toBe("OPEN");
    expect(marketState(new Date("2026-10-09T19:59:00Z"))).toBe("OPEN");
    expect(marketState(new Date("2026-10-09T20:00:00Z"))).toBe("POST");
    expect(marketState(new Date("2026-10-10T00:00:00Z"))).toBe("CLOSED");
  });

  it("is closed at weekends and on holidays, and closes early when the exchange does", () => {
    expect(marketState(new Date("2026-10-10T15:00:00Z"))).toBe("CLOSED");
    expect(marketState(new Date("2026-11-26T15:00:00Z"))).toBe("CLOSED");
    // 27 Nov 2026 is EST (UTC−5): 13:30 New York is after the early close.
    expect(marketState(new Date("2026-11-27T18:30:00Z"))).toBe("POST");
  });

  it("reads the time in New York, not the reader's zone", () => {
    expect(newYorkTime(new Date("2026-10-09T13:30:05Z")).clock).toBe("09:30:05");
  });
});

describe("terminalHref", () => {
  it("keeps the document site's links inside the terminal", () => {
    expect(terminalHref("/s/AAPL")).toBe("/t/s/AAPL");
    expect(terminalHref("/s/BRK.B?r=MAX#fa")).toBe("/t/s/BRK.B?r=MAX#fa");
    expect(terminalHref("/compare?s=AAPL,MSFT")).toBe("/t/compare?s=AAPL,MSFT");
    expect(terminalHref("/dcf")).toBe("/t/dcf");
  });

  it("leaves everything else alone", () => {
    expect(terminalHref("/")).toBeNull();
    expect(terminalHref("/settings")).toBeNull();
    expect(terminalHref("/t/s/AAPL")).toBeNull();
    expect(terminalHref("/research")).toBeNull();
    expect(terminalHref("/s/AAPL/extra")).toBeNull();
  });
});
