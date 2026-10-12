import { describe, expect, it } from "vitest";
import { buildSegments, largestPartition, trailingTwelve } from "@/lib/segments/build";
import { parseLabels, parseSegmentFacts, memberName, type SegmentFact } from "@/lib/segments/xbrl";
import { pickDocuments } from "@/lib/segments/source";
import { backlogCards, segmentChart, segmentRows, segmentViews } from "@/lib/segments/view";

const filing = { accession: "0001652044-26-000071", filed: "2026-07-24", form: "10-Q" };

/** A trimmed copy of Alphabet's instance: default namespace, as goog-20260630_htm.xml writes it. */
const INSTANCE = `<?xml version="1.0"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<context id="q"><entity><identifier scheme="x">1</identifier></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="cloud"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">goog:GoogleCloudMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="cloudOp"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:OperatingSegmentsMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">goog:GoogleCloudMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="opSeg"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:OperatingSegmentsMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="elim"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="srt:ConsolidationItemsAxis">us-gaap:IntersegmentEliminationMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">goog:GoogleCloudMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="hedge"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:DerivativeInstrumentRiskAxis">us-gaap:ForeignExchangeContractMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="search"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">goog:GoogleServicesMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">goog:GoogleSearchOtherMember</xbrldi:explicitMember></segment></entity><period><startDate>2026-04-01</startDate><endDate>2026-06-30</endDate></period></context>
<context id="rpo"><entity><identifier scheme="x">1</identifier><segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">goog:GoogleCloudMember</xbrldi:explicitMember></segment></entity><period><instant>2026-06-30</instant></period></context>
<unit id="usd"><measure>iso4217:USD</measure></unit>
<us-gaap:Revenues contextRef="q" unitRef="usd" decimals="-6">119800000000</us-gaap:Revenues>
<us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="cloud" unitRef="usd" decimals="-6">24770000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
<us-gaap:OperatingIncomeLoss contextRef="cloudOp" unitRef="usd" decimals="-6">8810000000</us-gaap:OperatingIncomeLoss>
<us-gaap:OperatingIncomeLoss contextRef="opSeg" unitRef="usd" decimals="-6">48000000000</us-gaap:OperatingIncomeLoss>
<us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="elim" unitRef="usd" decimals="-6">-100000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
<us-gaap:Revenues contextRef="hedge" unitRef="usd" decimals="-6">5000000</us-gaap:Revenues>
<us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="search" unitRef="usd" decimals="-6">63270000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
<us-gaap:RevenueRemainingPerformanceObligation contextRef="rpo" unitRef="usd" decimals="-8">513900000000</us-gaap:RevenueRemainingPerformanceObligation>
</xbrl>`;

describe("parseSegmentFacts", () => {
  const facts = parseSegmentFacts(INSTANCE, filing);
  const find = (measure: string, member: string) => facts.find((fact) => fact.measure === measure && fact.members.some(([, name]) => name === member));

  it("reads segment revenue, operating income and backlog from a default-namespace instance", () => {
    expect(find("revenue", "goog:GoogleCloudMember")?.value).toBe(24_770_000_000);
    expect(find("operatingIncome", "goog:GoogleCloudMember")?.value).toBe(8_810_000_000);
    const backlog = find("backlog", "goog:GoogleCloudMember");
    expect(backlog).toMatchObject({ value: 513_900_000_000, start: null, end: "2026-06-30" });
  });

  it("puts the product first and the segment it sits in second", () => {
    expect(find("revenue", "goog:GoogleSearchOtherMember")?.members).toEqual([["product", "goog:GoogleSearchOtherMember"], ["business", "goog:GoogleServicesMember"]]);
  });

  it("keeps the consolidated figure as the total, and drops subtotals, eliminations and other axes", () => {
    expect(facts.filter((fact) => !fact.members.length).map((fact) => fact.value)).toEqual([119_800_000_000]);
    expect(facts.some((fact) => fact.value === 48_000_000_000)).toBe(false);
    expect(facts.some((fact) => fact.value === -100_000_000)).toBe(false);
    expect(facts.some((fact) => fact.value === 5_000_000)).toBe(false);
  });
});

describe("labels", () => {
  const LINKBASE = `<link:labelLink>
    <link:loc xlink:type="locator" xlink:href="goog-20260630.xsd#goog_GoogleCloudMember" xlink:label="loc_cloud"/>
    <link:label xlink:type="resource" xlink:label="lab_cloud" xlink:role="http://www.xbrl.org/2003/role/label">Google Cloud [Member]</link:label>
    <link:label xlink:type="resource" xlink:label="lab_cloud" xlink:role="http://www.xbrl.org/2003/role/documentation">The cloud segment.</link:label>
    <link:labelArc xlink:type="arc" xlink:from="loc_cloud" xlink:to="lab_cloud"/>
  </link:labelLink>`;
  it("names a member as the filing labels it", () => {
    expect(parseLabels(LINKBASE).get("goog:GoogleCloudMember")).toBe("Google Cloud");
  });
  it("reads an unlabelled member from its name, and a standard one in plain words", () => {
    expect(memberName("nvda:ComputeAndNetworkingMember", new Map())).toBe("Compute and Networking");
    expect(memberName("us-gaap:CorporateNonSegmentMember", new Map([["us-gaap:CorporateNonSegmentMember", "Segment Reporting, Reconciling Item, Corporate Nonsegment"]]))).toBe("Corporate and unallocated");
  });
  it("finds the instance and the labels in a filing's index, the schema standing in for a missing linkbase", () => {
    expect(pickDocuments(["FilingSummary.xml", "goog-20260630_htm.xml", "goog-20260630_lab.xml", "goog-20260630.xsd"])).toEqual({ instance: "goog-20260630_htm.xml", labels: "goog-20260630_lab.xml" });
    expect(pickDocuments(["FilingSummary.xml", "msft-20260630_htm.xml", "msft-20260630.xsd"])).toEqual({ instance: "msft-20260630_htm.xml", labels: "msft-20260630.xsd" });
  });
});

const fact = (measure: SegmentFact["measure"], member: string | null, start: string | null, end: string, value: number, filed = "2026-01-30", parent?: string): SegmentFact => ({
  measure, concept: "us-gaap:Revenues", value, start, end, currency: "USD", accession: `acc-${filed}`, filed, form: "10-Q",
  members: member ? (parent ? [["product", member], ["business", parent]] : [["business", member]]) : [],
});

describe("buildSegments", () => {
  const quarters = [["2025-01-01", "2025-03-31"], ["2025-04-01", "2025-06-30"], ["2025-07-01", "2025-09-30"]];
  const facts: SegmentFact[] = [
    ...quarters.flatMap(([start, end], index) => [
      fact("revenue", "x:AMember", start, end, 10 + index), fact("revenue", "x:BMember", start, end, 5), fact("revenue", null, start, end, 15 + index),
    ]),
    fact("revenue", "x:AMember", "2025-01-01", "2025-12-31", 50, "2026-02-01"),
    fact("revenue", "x:BMember", "2025-01-01", "2025-12-31", 20, "2026-02-01"),
    fact("revenue", null, "2025-01-01", "2025-12-31", 70, "2026-02-01"),
    // Restated in a later filing: the later value wins.
    fact("revenue", "x:BMember", "2025-01-01", "2025-03-31", 6, "2026-05-01"),
    fact("revenue", null, "2025-01-01", "2025-03-31", 16, "2026-05-01"),
  ];
  const data = buildSegments({ ticker: "x", cik: "1", facts, labels: new Map(), filings: [] });
  const line = (id: string) => data.series.find((entry) => entry.id === id)!;

  it("derives the fourth quarter as the year less three quarters", () => {
    expect(line("revenue:business:x:AMember").quarterly.at(-1)).toMatchObject({ start: "2025-10-01", end: "2025-12-31", value: 17, derived: true });
  });
  it("takes a restated figure from the later filing", () => {
    expect(line("revenue:business:x:BMember").quarterly[0].value).toBe(6);
  });
  it("stacks only lines that add up to the reported total", () => {
    const quarterly = data.stacks.filter((stack) => stack.periodicity === "quarterly");
    expect(quarterly.map((stack) => stack.end)).toContain("2025-12-31");
    expect(quarterly.every((stack) => stack.ids.length === 2)).toBe(true);
  });

  it("drops a corporate line that is really the total, and merges a renamed member", () => {
    const renamed = buildSegments({
      ticker: "n", cik: "1", labels: new Map([["n:CnMember", "Compute"], ["n:CnSegmentMember", "Compute"]]), filings: [], facts: [
        fact("operatingIncome", "n:CnMember", "2024-01-01", "2024-03-31", 5, "2024-05-01"),
        fact("operatingIncome", "n:CnSegmentMember", "2025-01-01", "2025-03-31", 8, "2025-05-01"),
        fact("operatingIncome", "n:GMember", "2025-01-01", "2025-03-31", 2, "2025-05-01"),
        fact("operatingIncome", "us-gaap:CorporateNonSegmentMember", "2025-01-01", "2025-03-31", 10, "2025-05-01"),
      ],
    });
    expect(renamed.series.filter((entry) => entry.label === "Compute")).toHaveLength(1);
    expect(renamed.series.find((entry) => entry.label === "Compute")!.quarterly.map((point) => point.value)).toEqual([5, 8]);
    expect(renamed.series.some((entry) => entry.member === "us-gaap:CorporateNonSegmentMember")).toBe(false);
  });
});

describe("largestPartition", () => {
  it("prefers the finest cut that adds up, and refuses a near miss", () => {
    // Amazon-like: product + service = total, and five finer lines also = total.
    const billions = (list: number[]) => list.map((value) => value * 1e9);
    expect(largestPartition(billions([300, 420, 270, 170, 130, 70, 80]), 720e9)).toEqual([2, 3, 4, 5, 6]);
    expect(largestPartition(billions([300, 419.5]), 720e9)).toBeNull();
  });
});

describe("views", () => {
  const facts: SegmentFact[] = [];
  const ends = [["2024-04-01", "2024-06-30"], ["2024-07-01", "2024-09-30"], ["2024-10-01", "2024-12-31"], ["2025-01-01", "2025-03-31"], ["2025-04-01", "2025-06-30"]];
  ends.forEach(([start, end], index) => {
    facts.push(fact("revenue", "c:CloudMember", start, end, 10 + index, "2025-07-30"), fact("revenue", "c:AdsMember", start, end, 30, "2025-07-30"), fact("revenue", null, start, end, 40 + index, "2025-07-30"));
    facts.push(fact("operatingIncome", "c:CloudMember", start, end, 2 + index, "2025-07-30"));
  });
  facts.push(fact("backlog", "c:CloudMember", null, "2025-06-30", 140, "2025-07-30"));
  const data = buildSegments({ ticker: "c", cik: "1", facts, labels: new Map(), filings: [] });
  const [view] = segmentViews(data);

  it("offers the segments as a stacked chart that reconciles", () => {
    const chart = segmentChart(data, view, "quarterly")!;
    expect(chart.reconciled).toBe(true);
    expect(chart.totals.at(-1)).toBe(44);
    expect(chart.series.map((line) => line.label)).toEqual(["Ads", "Cloud"]);
  });
  it("states growth, share, TTM, margin and backlog per line", () => {
    const cloud = segmentRows(data, view, "quarterly").find((row) => row.label === "Cloud")!;
    expect(cloud.latest?.value).toBe(14);
    expect(cloud.yoy).toBeCloseTo(14 / 10 - 1);
    expect(cloud.share).toBeCloseTo(14 / 44);
    expect(cloud.ttm).toBe(11 + 12 + 13 + 14);
    expect(cloud.margin).toBeCloseTo(6 / 14);
    expect(cloud.backlog?.value).toBe(140);
  });
  it("sets the backlog against the segment's last twelve months", () => {
    expect(backlogCards(data)[0]).toMatchObject({ label: "Cloud", coverage: 140 / 50 });
  });
  it("reads a quarterly series' trailing twelve months only over four consecutive quarters", () => {
    expect(trailingTwelve(data.series.find((line) => line.label === "Cloud" && line.measure === "revenue")!.quarterly).map((point) => point.value)).toEqual([46, 50]);
  });
});
