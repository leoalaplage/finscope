import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseForm4, recentForm4s } from "../lib/adapters/insiders";

/**
 * A Form 4, and the distinction the whole section turns on.
 *
 * Most rows on these filings are not decisions: a grant vests, an option is
 * exercised, shares are withheld to pay the tax on that exercise. Summed
 * together they announce "insider selling" at every company on earth, because
 * compensation is paid in stock and stock has to be sold to pay tax on it.
 * Only an open-market purchase or sale is somebody choosing, with their own
 * money, to own more or less of what they run.
 */
const fixture = readFileSync(new URL("./fixtures/form4-aapl.xml", import.meta.url), "utf8");

/** A Form 4 carrying exactly the rows a test is about, shaped as EDGAR files them. */
const form4 = (rows: Array<{ code: string; shares: number; price: number | null; disposed: boolean }>) => `
<ownershipDocument>
  <documentType>4</documentType>
  <issuer><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>true</isDirector></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>${rows.map((row) => `
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-06-15</value></transactionDate>
      <transactionCoding><transactionCode>${row.code}</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${row.shares}</value></transactionShares>
        <transactionPricePerShare>${row.price == null ? '<footnoteId id="F1"/>' : `<value>${row.price}</value>`}</transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${row.disposed ? "D" : "A"}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>`).join("")}
  </nonDerivativeTable>
</ownershipDocument>`;
const rows = parseForm4(fixture, "0001140361-26-035636", "2026-09-03", "https://example.test/form4.xml");

describe("reading a Form 4", () => {
  it("reads the transaction, the person and what they were left holding", () => {
    expect(rows).toHaveLength(1);
    const [sale] = rows;
    expect(sale.owner).toBe("Newstead Jennifer");
    expect(sale.role).toBe("Officer · SVP, GC and Government Affairs");
    expect(sale.date).toBe("2026-09-01");
    // The day it was filed is not the day it happened, and both are kept.
    expect(sale.filedAt).toBe("2026-09-03");
    expect(sale.shares).toBe(1439);
    expect(sale.price).toBeCloseTo(317.01, 2);
    expect(sale.value).toBeCloseTo(1439 * 317.01, 2);
    expect(sale.direction).toBe("disposed");
    expect(sale.sharesAfter).toBe(35790);
  });

  it("names an open-market sale as a decision", () => {
    expect(rows[0].code).toBe("S");
    expect(rows[0].kind).toBe("open-market");
    expect(rows[0].codeLabel).toBe("Open-market sale");
  });

  it("reads a security title that carries a footnote beside its value", () => {
    // The tag holds <value>Common Stock</value> and a <footnoteId/>. Taking the
    // element's text would return both; taking the value returns the title.
    expect(rows[0].security).toBe("Common Stock");
  });

  it("separates compensation from choice, and prices neither as the other", () => {
    /*
     * The two rows a vesting produces: an exercise, which has no price because
     * nothing was paid at market, and the shares withheld to settle the tax on
     * it. On Apple the second was a disposal of $4.8m that nobody decided to
     * make, and the largest recent one — which is exactly the figure a tool
     * that summed every row would have reported as insider selling.
     */
    const rows = parseForm4(form4([
      { code: "M", shares: 30104, price: null, disposed: false },
      { code: "F", shares: 16238, price: 296.42, disposed: true },
      { code: "A", shares: 5000, price: null, disposed: false },
      { code: "G", shares: 100, price: null, disposed: true },
    ]), "x", "2026-06-17", "u");

    expect(rows.map((row) => [row.kind, row.codeLabel])).toEqual([
      ["exercise", "Option exercise"],
      ["tax", "Shares withheld for tax"],
      ["award", "Grant or award"],
      ["gift", "Gift"],
    ]);
    // Nothing was paid at market, so nothing is stated. Nought is not a price.
    expect(rows[0].price).toBeNull();
    expect(rows[0].value).toBeNull();
    // The tax row does carry a value, and it is still not a decision.
    expect(rows[1].value).toBeCloseTo(16238 * 296.42, 2);
    expect(rows.some((row) => row.kind === "open-market")).toBe(false);
  });

  it("keeps an unknown code rather than dropping the row", () => {
    // A letter this map does not carry is still a filed transaction. It is
    // named for what it is — a code — and kept out of the decisions total.
    const [row] = parseForm4(form4([{ code: "K", shares: 10, price: null, disposed: true }]), "x", "2026-01-01", "u");
    expect(row.kind).toBe("other");
    expect(row.codeLabel).toBe("Code K");
  });

  it("takes the newest Form 4s and only Form 4s", () => {
    const index = {
      form: ["4", "8-K", "4", "10-Q", "4"],
      accessionNumber: ["a", "b", "c", "d", "e"],
      filingDate: ["2026-09-03", "2026-09-02", "2026-09-01", "2026-08-30", "2026-08-27"],
    };
    expect(recentForm4s(index, 2)).toEqual([
      { accession: "a", filedAt: "2026-09-03" },
      { accession: "c", filedAt: "2026-09-01" },
    ]);
    expect(recentForm4s(index).map((filing) => filing.accession)).toEqual(["a", "c", "e"]);
  });

  it("states nothing rather than guessing when a document is not a Form 4", () => {
    expect(parseForm4("<ownershipDocument></ownershipDocument>", "x", "2026-01-01", "u")).toEqual([]);
    expect(parseForm4("not xml at all", "x", "2026-01-01", "u")).toEqual([]);
  });
});
