import { describe, expect, it } from "vitest";
import { balanceSheetDebt, filingIsAhead, instanceDocument, mergeFactTrees, newestReportedEnd, parseXbrlInstance, quotedClassShares, type FactTree } from "../lib/adapters/xbrl-instance";

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

// The shape of Berkshire Hathaway's June 2026 10-Q: counts and earnings per share filed per class only.
const CLASSES = `<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:brka="http://www.berkshirehathaway.com/20260630" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="q"><entity><identifier>1</identifier></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
  <context id="qA"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">brka:EquivalentClassAMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
  <context id="qB"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">brka:EquivalentClassBMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
  <context id="iA"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">brka:EquivalentClassAMember</xbrldi:explicitMember></segment></entity><period><instant>2026-06-30</instant></period></context>
  <context id="iB"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonClassBMember</xbrldi:explicitMember></segment></entity><period><instant>2026-06-30</instant></period></context>
  <unit id="shares"><measure>shares</measure></unit>
  <us-gaap:NetIncomeLoss contextRef="q" unitRef="usd" decimals="-6">25667000000</us-gaap:NetIncomeLoss>
  <us-gaap:EarningsPerShareBasic contextRef="qA" unitRef="usdPerShare" decimals="0">17868</us-gaap:EarningsPerShareBasic>
  <us-gaap:EarningsPerShareBasic contextRef="qB" unitRef="usdPerShare" decimals="2">11.91</us-gaap:EarningsPerShareBasic>
  <us-gaap:WeightedAverageNumberOfSharesOutstandingBasic contextRef="qA" unitRef="shares" decimals="INF">1436443</us-gaap:WeightedAverageNumberOfSharesOutstandingBasic>
  <us-gaap:WeightedAverageNumberOfSharesOutstandingBasic contextRef="qB" unitRef="shares" decimals="INF">2154664073</us-gaap:WeightedAverageNumberOfSharesOutstandingBasic>
  <us-gaap:CommonStockSharesOutstanding contextRef="iA" unitRef="shares" decimals="INF">1431693</us-gaap:CommonStockSharesOutstanding>
  <us-gaap:CommonStockSharesOutstanding contextRef="iB" unitRef="shares" decimals="INF">1395887484</us-gaap:CommonStockSharesOutstanding>
</xbrl>`;

describe("share counts filed only per class of stock", () => {
  const filing = { accession: "0001193125-26-341032", form: "10-Q", filed: "2026-08-03" };

  it("reads the class the ticker names, proved against net income, and converts the other class's shares outstanding", () => {
    const { facts: tree, ratio } = quotedClassShares(CLASSES, filing, "BRK.B");
    expect(ratio).toBe(1500);
    expect(tree["us-gaap"].WeightedAverageNumberOfSharesOutstandingBasic.units.shares).toMatchObject([{ start: "2026-04-01", end: "2026-06-30", val: 2154664073 }]);
    // Class A equivalents at 1,500 Class B each; the Class B line alone is a slice of the company and is not used.
    expect(tree["us-gaap"].CommonStockSharesOutstanding.units.shares).toMatchObject([{ end: "2026-06-30", val: 1431693 * 1500 }]);
  });

  it("reads nothing for a ticker that names no class, or a count that does not give net income back", () => {
    expect(quotedClassShares(CLASSES, filing, "BRK").facts).toEqual({});
    expect(quotedClassShares(CLASSES.replace(">25667000000<", ">40000000000<"), filing, "BRK.B").facts).toEqual({});
  });
});

// Caterpillar's June 2026 10-Q: every borrowing line tagged for ME&T and for Financial Products, never in total.
const SPLIT_DEBT = `<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2026" xmlns:cat="http://www.caterpillar.com/20260630" xmlns:srt="http://fasb.org/srt/2026" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="me"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">cat:MachineryPowerEnergyMember</xbrldi:explicitMember></segment></entity><period><instant>2026-06-30</instant></period></context>
  <context id="fp"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">cat:FinancialProductsMember</xbrldi:explicitMember></segment></entity><period><instant>2026-06-30</instant></period></context>
  <context id="whole"><entity><identifier>1</identifier></entity><period><instant>2026-06-30</instant></period></context>
  <us-gaap:ShortTermBorrowings contextRef="fp" unitRef="usd">5046000000</us-gaap:ShortTermBorrowings>
  <us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent contextRef="me" unitRef="usd">35000000</us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent>
  <us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent contextRef="fp" unitRef="usd">8026000000</us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent>
  <us-gaap:LongTermDebtAndCapitalLeaseObligations contextRef="me" unitRef="usd">10655000000</us-gaap:LongTermDebtAndCapitalLeaseObligations>
  <us-gaap:LongTermDebtAndCapitalLeaseObligations contextRef="fp" unitRef="usd">21384000000</us-gaap:LongTermDebtAndCapitalLeaseObligations>
  <us-gaap:DebtCurrent contextRef="whole" unitRef="usd">13796000000</us-gaap:DebtCurrent>
  <cat:LongTermDebtAndFinanceLeasesNoncurrent contextRef="whole" unitRef="usd">43544000000</cat:LongTermDebtAndFinanceLeasesNoncurrent>
</xbrl>`;

describe("borrowings a balance sheet states only in parts, or under its own name", () => {
  const filing = { accession: "0000018230-26-000046", form: "10-Q", filed: "2026-08-04" };
  const tree = balanceSheetDebt(SPLIT_DEBT, filing);
  const at = (namespace: string, concept: string) => tree[namespace]?.[concept]?.units.USD.map((fact) => fact.val);

  it("sums a line over the business parts it is tagged for, where no total is tagged", () => {
    expect(at("us-gaap", "ShortTermBorrowings")).toEqual([5046000000]);
    expect(at("us-gaap", "LongTermDebtAndCapitalLeaseObligationsCurrent")).toEqual([8061000000]);
    expect(at("us-gaap", "LongTermDebtAndCapitalLeaseObligations")).toEqual([32039000000]);
    // A line tagged in total is left to the feed, which carries it.
    expect(at("us-gaap", "DebtCurrent")).toBeUndefined();
  });

  it("reads the company's own non-current debt line only where no standard one stands at the date", () => {
    // Here the parts above give a standard non-current line at the date, so the own line is not taken.
    expect(tree.company).toBeUndefined();
    const own = balanceSheetDebt(SPLIT_DEBT.replace(/<us-gaap:LongTermDebtAndCapitalLeaseObligations contextRef[^\n]*\n/g, ""), filing);
    expect(own.company?.LongTermDebtNoncurrent?.units.USD.map((fact) => fact.val)).toEqual([43544000000]);
  });

  it("does not add parts that include an elimination", () => {
    const eliminated = SPLIT_DEBT.replace("cat:FinancialProductsMember", "cat:ConsolidatingAdjustmentsMember");
    expect(balanceSheetDebt(eliminated, filing)["us-gaap"]?.ShortTermBorrowings).toBeUndefined();
  });
});
