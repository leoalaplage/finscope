import { describe, expect, it } from "vitest";
import { filingIsAhead, instanceDocument, mergeFactTrees, newestReportedEnd, parseXbrlInstance, type FactTree } from "../lib/adapters/xbrl-instance";

// Cut from Coca-Cola's June 2026 10-Q instance, ko-20260703_htm.xml, in its own layout.
const INSTANCE = `<?xml version="1.0" encoding="utf-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2026" xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:ko="http://www.thecocacolacompany.com/20260703" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
    <context id="c-1">
        <entity><identifier scheme="http://www.sec.gov/CIK">0000021344</identifier></entity>
        <period><startDate>2026-01-01</startDate><endDate>2026-07-03</endDate></period>
    </context>
    <context id="c-2">
        <entity>
            <identifier scheme="http://www.sec.gov/CIK">0000021344</identifier>
            <segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">ko:CommonStock0.25ParValueMember</xbrldi:explicitMember></segment>
        </entity>
        <period><startDate>2026-01-01</startDate><endDate>2026-07-03</endDate></period>
    </context>
    <context id="c-22">
        <entity><identifier scheme="http://www.sec.gov/CIK">0000021344</identifier></entity>
        <period><startDate>2026-04-04</startDate><endDate>2026-07-03</endDate></period>
    </context>
    <context id="c-9">
        <entity><identifier scheme="http://www.sec.gov/CIK">0000021344</identifier></entity>
        <period><instant>2026-07-03</instant></period>
    </context>
    <unit id="shares"><measure>shares</measure></unit>
    <unit id="usd"><measure>iso4217:USD</measure></unit>
    <unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>shares</measure></unitDenominator></divide></unit>
    <dei:DocumentType contextRef="c-1" id="f-1">10-Q</dei:DocumentType>
    <dei:DocumentFiscalPeriodFocus contextRef="c-1" id="f-81">Q2</dei:DocumentFiscalPeriodFocus>
    <dei:DocumentFiscalYearFocus contextRef="c-1" id="f-82">2026</dei:DocumentFiscalYearFocus>
    <us-gaap:Revenues contextRef="c-22" decimals="-6" id="f-84" unitRef="usd">13380000000</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="c-1" decimals="-6" id="f-86" unitRef="usd">25852000000</us-gaap:Revenues>
    <us-gaap:Revenues contextRef="c-2" decimals="-6" id="f-87" unitRef="usd">99</us-gaap:Revenues>
    <us-gaap:NetCashProvidedByUsedInOperatingActivities contextRef="c-1" decimals="-6" id="f-296" unitRef="usd">7543000000</us-gaap:NetCashProvidedByUsedInOperatingActivities>
    <us-gaap:EarningsPerShareDiluted contextRef="c-22" decimals="2" id="f-90" unitRef="usdPerShare">1.03</us-gaap:EarningsPerShareDiluted>
    <us-gaap:CashAndCashEquivalentsAtCarryingValue contextRef="c-9" decimals="-6" id="f-91" unitRef="usd">10500000000</us-gaap:CashAndCashEquivalentsAtCarryingValue>
    <us-gaap:DescriptionOfBusinessTextBlock contextRef="c-1" id="f-92">&lt;p&gt;Beverages&lt;/p&gt;</us-gaap:DescriptionOfBusinessTextBlock>
    <ko:SomethingOwn contextRef="c-1" unitRef="usd" id="f-93">5</ko:SomethingOwn>
</xbrl>`;

const filing = { accession: "0001628280-26-050503", form: "10-Q", filed: "2026-07-29" };

describe("a filing's own XBRL, read as Company Facts serves it", () => {
  const tree = parseXbrlInstance(INSTANCE, filing);

  it("reads the quarter and the year to date on the company as a whole", () => {
    expect(tree["us-gaap"].Revenues.units.USD).toEqual([
      { start: "2026-04-04", end: "2026-07-03", val: 13_380_000_000, accn: filing.accession, fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-07-29" },
      { start: "2026-01-01", end: "2026-07-03", val: 25_852_000_000, accn: filing.accession, fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-07-29" },
    ]);
    expect(tree["us-gaap"].NetCashProvidedByUsedInOperatingActivities.units.USD[0].val).toBe(7_543_000_000);
  });

  it("names units as Company Facts does, and reads balances at their date", () => {
    expect(tree["us-gaap"].EarningsPerShareDiluted.units["USD/shares"][0].val).toBe(1.03);
    expect(tree["us-gaap"].CashAndCashEquivalentsAtCarryingValue.units.USD[0]).toMatchObject({ end: "2026-07-03", val: 10_500_000_000 });
    expect(tree["us-gaap"].CashAndCashEquivalentsAtCarryingValue.units.USD[0].start).toBeUndefined();
  });

  it("leaves out a slice of the company, text, and the company's own taxonomy", () => {
    expect(tree["us-gaap"].Revenues.units.USD.some((fact) => fact.val === 99)).toBe(false);
    expect(tree["us-gaap"].DescriptionOfBusinessTextBlock).toBeUndefined();
    expect(tree.ko).toBeUndefined();
  });

  it("adds a filing's figures to the feed without doubling one it already has", () => {
    const feed: FactTree = { "us-gaap": { Revenues: { units: { USD: [
      { start: "2026-01-01", end: "2026-04-03", val: 12_472_000_000, accn: "0000021344-26-000010", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-04-30" },
      { start: "2026-01-01", end: "2026-07-03", val: 25_852_000_000, accn: filing.accession, fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-07-29" },
    ] } } } };
    const merged = mergeFactTrees(feed, tree);
    expect(merged["us-gaap"].Revenues.units.USD).toHaveLength(3);
    expect(feed["us-gaap"].Revenues.units.USD).toHaveLength(2);
    expect(newestReportedEnd(feed)).toBe("2026-07-03");
  });

  it("knows when the SEC's own filing list is ahead of the feed", () => {
    const feed: FactTree = { "us-gaap": { Revenues: { units: { USD: [
      { start: "2026-01-01", end: "2026-04-03", val: 1, accn: "a", fy: 2026, fp: "Q1", form: "10-Q", filed: "2026-04-30" },
    ] } } } };
    expect(filingIsAhead(feed, { form: "10-Q", reportDate: "2026-07-03" })).toBe(true);
    expect(filingIsAhead(feed, { form: "10-Q", reportDate: "2026-04-03" })).toBe(false);
    expect(filingIsAhead(feed, { form: "8-K", reportDate: "2026-09-01" })).toBe(false);
  });

  it("finds the instance among a filing's documents", () => {
    expect(instanceDocument(["FilingSummary.xml", "ko-20260703_cal.xml", "ko-20260703_htm.xml", "ko-20260703.htm"])).toBe("ko-20260703_htm.xml");
    expect(instanceDocument(["FilingSummary.xml", "abc-20100331_lab.xml", "abc-20100331.xml"])).toBe("abc-20100331.xml");
    expect(instanceDocument(["R1.htm"])).toBeNull();
  });
});
