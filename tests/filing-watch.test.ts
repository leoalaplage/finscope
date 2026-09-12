import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { coveredFilings, givenUp, parseCurrentFilings, withNewFilings, type Watches } from "../lib/filing-watch";
import { DEFAULT_WATCHLIST } from "../lib/company-registry";

/**
 * Putting a filing on screen in half an hour rather than in a day.
 *
 * The daily warm is the right cadence for figures that change quarterly —
 * except on the one day a quarter they change, when a reader opens the page of
 * the company that has just reported and finds the previous quarter.
 */
const entry = (title: string, accession: string, filed = "2026-09-11") => `
<entry>
<title>${title}</title>
<summary type="html">
 &lt;b&gt;Filed:&lt;/b&gt; ${filed} &lt;b&gt;AccNo:&lt;/b&gt; ${accession} &lt;b&gt;Size:&lt;/b&gt; 7 MB
</summary>
<updated>${filed}T17:11:29-04:00</updated>
</entry>`;

const feed = (...entries: string[]) => `<?xml version="1.0" encoding="ISO-8859-1" ?><feed>${entries.join("")}</feed>`;

describe("reading EDGAR's feed of what it has just accepted", () => {
  it("takes the form, the filer and the accession out of each entry", () => {
    const xml = feed(entry("10-Q - Reformation Inc. (0001787117) (Filer)", "0001628280-26-061594"));
    expect(parseCurrentFilings(xml)).toEqual([
      { cik: "1787117", form: "10-Q", accession: "0001628280-26-061594", filed: "2026-09-11" },
    ]);
  });

  it("keeps the slash in an amended form rather than cutting at the first dash", () => {
    // "10-K/A" has a dash of its own; splitting on it would file the form as "10".
    const xml = feed(entry("10-K/A - COPART INC (0000900075) (Filer)", "0001193125-26-356968"));
    expect(parseCurrentFilings(xml)[0].form).toBe("10-K/A");
  });

  it("skips an entry it cannot read rather than failing the run", () => {
    expect(parseCurrentFilings(feed("<entry><title>nonsense</title></entry>", entry("10-K - X (0000320193) (Filer)", "0000320193-26-000001")))).toHaveLength(1);
    expect(parseCurrentFilings("not xml at all")).toEqual([]);
  });
});

describe("which filings are ours", () => {
  const filings = [
    { cik: "1787117", form: "10-Q", accession: "a", filed: "2026-09-11" },
    { cik: "320193", form: "10-Q", accession: "b", filed: "2026-09-11" },
    { cik: "1652044", form: "10-K", accession: "c", filed: "2026-09-11" },
    { cik: "320193", form: "8-K", accession: "d", filed: "2026-09-11" },
    { cik: "900075", form: "10-12G/A", accession: "e", filed: "2026-09-11" },
  ];

  it("matches by CIK, so one filer can reach both of its tickers", () => {
    // Alphabet files once and this site carries GOOGL and GOOG against it.
    const matched = coveredFilings(filings);
    expect(matched.filter((each) => each.filing.accession === "c").map((each) => each.ticker).sort()).toEqual(["GOOG", "GOOGL"]);
    expect(matched.some((each) => each.ticker === "AAPL")).toBe(true);
  });

  it("ignores a filer nobody here follows", () => {
    expect(coveredFilings(filings).some((each) => each.filing.cik === "1787117")).toBe(false);
  });

  it("ignores forms that carry no statements", () => {
    // An 8-K is news — the earnings release itself — and a registration
    // statement is not a report. Neither brings new figures to read.
    const forms = coveredFilings(filings).map((each) => each.filing.form);
    expect(forms).not.toContain("8-K");
    expect(forms).not.toContain("10-12G/A");
  });

  it("reads the registry's padded CIKs and the feed's unpadded ones as the same number", () => {
    const apple = DEFAULT_WATCHLIST.find((company) => company.ticker === "AAPL")!;
    expect(apple.cik).toBe("0000320193");
    expect(coveredFilings([{ cik: "320193", form: "10-K", accession: "x", filed: "2026-09-11" }]).map((each) => each.ticker)).toEqual(["AAPL"]);
  });
});

describe("the outstanding list", () => {
  const watches: Watches = { AAPL: { accession: "old", form: "10-Q", filed: "2026-08-01", tries: 7 } };

  it("adds a company that has just filed", () => {
    const next = withNewFilings({}, coveredFilings([{ cik: "320193", form: "10-Q", accession: "new", filed: "2026-09-11" }]));
    expect(next.AAPL).toEqual({ accession: "new", form: "10-Q", filed: "2026-09-11", tries: 0 });
  });

  it("leaves a filing already being chased alone, count and all", () => {
    const next = withNewFilings(watches, coveredFilings([{ cik: "320193", form: "10-Q", accession: "old", filed: "2026-08-01" }]));
    expect(next.AAPL.tries).toBe(7);
  });

  it("replaces it with a newer filing and starts counting again", () => {
    // An amendment filed the day after is the thing to wait for now.
    const next = withNewFilings(watches, coveredFilings([{ cik: "320193", form: "10-Q/A", accession: "newer", filed: "2026-09-11" }]));
    expect(next.AAPL).toEqual({ accession: "newer", form: "10-Q/A", filed: "2026-09-11", tries: 0 });
  });

  it("gives up after a day of asking", () => {
    // Half-hourly runs, so forty-eight tries is twenty-four hours — by which
    // time the daily warm has had its own turn anyway.
    expect(givenUp({ accession: "x", form: "10-K", filed: "2026-09-11", tries: 47 })).toBe(false);
    expect(givenUp({ accession: "x", form: "10-K", filed: "2026-09-11", tries: 48 })).toBe(true);
  });
});

/**
 * A rebuilt dataset is not a rebuilt page.
 *
 * The company view is derived from the dataset once and kept for a day under
 * its own key. Chasing a filing into the store and leaving the view alone puts
 * the new quarter on the site and keeps it invisible on it.
 */
describe("the page's own copy", () => {
  it("is dropped by the same key the endpoint writes it under", () => {
    const watcher = readFileSync("lib/filing-watch.ts", "utf8");
    const route = readFileSync("app/api/io/[ticker]/route.ts", "utf8");
    const key = /`view:\$\{VIEW_SHAPE\}\.\$\{KEY_VERSION\}:\$\{ticker\.toUpperCase\(\)\}`/;
    expect(watcher).toMatch(key);
    // The endpoint writes it, here or through a helper spelled the same way.
    expect(route.includes("view:${VIEW_SHAPE}.${KEY_VERSION}") || /ioViewKey/.test(route)).toBe(true);
    expect(watcher).toMatch(/cache\?\.delete\(viewKey\(ticker\)\)/);
  });
});
