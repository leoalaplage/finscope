import { describe, expect, it } from "vitest";
import { SPARK_BATCH, yahooSymbol } from "../lib/adapters/spark";
import { COMPANIES } from "../lib/company-registry";
import { KNOWN_SUCCESSORS, UNIVERSE, UNIVERSE_AS_OF, UNIVERSE_NAME, UNIVERSE_TICKERS, universeMember } from "../lib/universe";
import { BUILD_PER_RUN, STALE_AFTER_HOURS, nextToBuild, universeKey, type UniverseRow, type UniverseTable } from "../lib/universe-build";

/**
 * The list a screener is allowed to look through.
 *
 * The screener could only ever score what a reader already followed, which
 * makes it a calculator rather than a search: to find a company you had to
 * know it first.
 */
describe("the universe", () => {
  it("is the index, dated, and names itself", () => {
    expect(UNIVERSE_NAME).toBe("S&P 500");
    // A membership is an editorial decision that changes a few times a year.
    // The date it was taken is part of the answer, not a footnote.
    expect(UNIVERSE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(UNIVERSE.length).toBeGreaterThan(495);
    expect(UNIVERSE.length).toBeLessThan(515);
  });

  it("carries an identifier the SEC would recognise for every member", () => {
    // Ten digits, left-padded, which is the only form the filings API accepts.
    for (const member of UNIVERSE) {
      expect(member.cik, member.ticker).toMatch(/^\d{10}$/);
      expect(member.name.length, member.ticker).toBeGreaterThan(1);
    }
  });

  it("lists each company once, and each share class on its own", () => {
    expect(new Set(UNIVERSE_TICKERS).size).toBe(UNIVERSE.length);
    // Alphabet and Fox sit in the index twice, and each class files and trades
    // on its own — two rows, one identifier.
    const alphabet = UNIVERSE.filter((member) => member.ticker === "GOOG" || member.ticker === "GOOGL");
    expect(alphabet).toHaveLength(2);
    expect(new Set(alphabet.map((member) => member.cik)).size).toBe(1);
  });

  it("writes a symbol the way this application writes it, not the way the SEC does", () => {
    // The site says BRK.B and the SEC says BRK-B; the registry and the universe
    // have to agree or the same company is two companies.
    const classes = UNIVERSE.filter((member) => member.ticker.includes("."));
    expect(classes.length).toBeGreaterThan(0);
    for (const member of classes) expect(member.ticker).not.toContain("-");
    expect(yahooSymbol("BRK.B")).toBe("BRK-B");
  });

  it("agrees with the built-in registry, or says exactly where it does not", () => {
    /*
     * A company in both must be the same company — unless a reorganisation
     * moved the ticker to a new filer and left the history behind the old one,
     * which is measured, named, and read deliberately. An unexplained
     * divergence is a company silently built from the wrong filings.
     */
    for (const company of COMPANIES) {
      const member = universeMember(company.ticker);
      if (!member || !company.cik) continue;
      const registry = company.cik.padStart(10, "0");
      const known = KNOWN_SUCCESSORS[company.ticker];
      if (!known) {
        expect(member.cik, company.ticker).toBe(registry);
        continue;
      }
      expect(known.reads, company.ticker).toBe(registry);
      expect(known.listed, company.ticker).toBe(member.cik);
      expect(known.why.length).toBeGreaterThan(40);
    }
  });

  it("keeps Exxon on the filer that has the filings", () => {
    // Measured against the SEC: the holding company carries 94 concepts and one
    // quarter, the operating company 438 and revenue back to 2011.
    const exxon = COMPANIES.find((company) => company.ticker === "XOM");
    expect(exxon?.cik?.padStart(10, "0")).toBe("0000034088");
    expect(universeMember("XOM")?.cik).toBe("0002115436");
  });

  it("finds a member however the symbol is cased", () => {
    expect(universeMember("aapl")?.name).toBeTruthy();
    expect(universeMember("NOT-A-TICKER")).toBeNull();
  });
});

/**
 * Filling the table, forty companies at a time.
 *
 * Normalizing a company costs about a quarter of a second of processor time —
 * measured against production — and a scheduled invocation is allowed thirty.
 */
describe("which companies the next run reads", () => {
  const table = (rows: Array<[string, string]>): UniverseTable => ({
    name: UNIVERSE_NAME, asOf: UNIVERSE_AS_OF, builtAt: "2026-09-12T00:00:00.000Z", members: UNIVERSE.length,
    rows: rows.map(([ticker, retrievedAt]) => ({ ticker, name: ticker, qs: {}, qsPrice: {}, retrievedAt } as unknown as UniverseRow)),
    prices: {}, pending: [],
  });

  it("reads what it has never read, in the order the index lists it", () => {
    const first = nextToBuild(null, 5);
    expect(first).toEqual(UNIVERSE.slice(0, 5).map((member) => member.ticker));
  });

  it("never asks for more than one run's worth", () => {
    expect(nextToBuild(null).length).toBe(BUILD_PER_RUN);
    expect(BUILD_PER_RUN).toBeLessThanOrEqual(150);
    expect(nextToBuild(null, 3)).toHaveLength(3);
  });

  it("finishes the missing ones before it refreshes anything", () => {
    const held = UNIVERSE.slice(0, 400).map((member) => [member.ticker, "2020-01-01T00:00:00.000Z"] as [string, string]);
    const next = nextToBuild(table(held), 5);
    expect(next).toEqual(UNIVERSE.slice(400, 405).map((member) => member.ticker));
  });

  it("asks for nothing at all when the table is full and current", () => {
    /*
     * The filing watcher is what keeps this table fresh — it sees a report
     * within half an hour and now watches every company in the index. The
     * rotation is the net under it, and a net that fires constantly would
     * rebuild five hundred companies round the clock to arrive at the figures
     * already in hand.
     */
    const now = new Date("2026-09-12T08:00:00.000Z");
    const fresh = UNIVERSE.map((member) => [member.ticker, "2026-09-12T06:00:00.000Z"] as [string, string]);
    expect(nextToBuild(table(fresh), 100, now)).toEqual([]);
    expect(STALE_AFTER_HOURS).toBe(72);
  });

  it("reads again what nobody has read in three days", () => {
    const now = new Date("2026-09-12T08:00:00.000Z");
    const rows = UNIVERSE.map((member, index) =>
      [member.ticker, index === 3 ? "2026-09-01T00:00:00.000Z" : "2026-09-12T06:00:00.000Z"] as [string, string]);
    expect(nextToBuild(table(rows), 100, now)).toEqual([UNIVERSE[3].ticker]);
  });

  it("refreshes the oldest first once nothing is missing", () => {
    const held = UNIVERSE.map((member, index) =>
      [member.ticker, `2026-0${index === 7 ? 1 : 9}-01T00:00:00.000Z`] as [string, string]);
    expect(nextToBuild(table(held), 1, new Date("2026-09-12T08:00:00.000Z"))).toEqual([UNIVERSE[7].ticker]);
  });

  it("stores the table under the dataset version and the digest shape", () => {
    // A table built from digests under older semantics must never be read back
    // as though it were built under these.
    expect(universeKey()).toMatch(/^universe:u1\.v\d+\.s\d+$/);
  });

  it("asks Yahoo for no more symbols than it will answer for", () => {
    // Measured against the endpoint: twenty is answered, fifty is refused.
    expect(SPARK_BATCH).toBe(20);
  });
});
