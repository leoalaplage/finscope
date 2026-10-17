import { describe, expect, it } from "vitest";
import { buildSegments, largestPartition, trailingTwelve } from "@/lib/segments/build";
import { parseLabels, parseSegmentFacts, memberName, type SegmentFact } from "@/lib/segments/xbrl";
import { pickDocuments, withPredecessor } from "@/lib/segments/source";
import { KNOWN_SUCCESSORS, PREDECESSORS, UNIVERSE, universeMember } from "@/lib/universe";
import { FILED_NAMES } from "@/lib/universe-names";
import { buildCustomers, customerKind, matchCompany, parseCustomerFacts, type CustomerFact } from "@/lib/segments/customers";
import { edgesOf, suppliersFrom, type Edge } from "@/lib/segments/relations";
import { backlogCards, revenueCuts, segmentChart, segmentRows, segmentViews } from "@/lib/segments/view";
import { segmentCharts } from "@/lib/segments/charts";

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

  it("joins a line renamed in the taxonomy when the restated report repeats a period at the same value, and not otherwise", () => {
    // Microsoft's Gaming became XBOX: the new name's first report restates the last quarter of the old one.
    const built = buildSegments({
      ticker: "m", cik: "1", labels: new Map([["m:GamingMember", "Gaming"], ["m:XboxMember", "XBOX"], ["m:DynMember", "Dynamics"], ["m:DynCloudMember", "Dynamics cloud"]]), filings: [], facts: [
        fact("revenue", "m:GamingMember", "2025-01-01", "2025-03-31", 5_000_000_000, "2025-05-01"),
        fact("revenue", "m:GamingMember", "2025-04-01", "2025-06-30", 5_200_000_000, "2025-08-01"),
        fact("revenue", "m:XboxMember", "2025-04-01", "2025-06-30", 5_200_000_000, "2025-11-01"),
        fact("revenue", "m:XboxMember", "2025-07-01", "2025-09-30", 5_400_000_000, "2025-11-01"),
        fact("revenue", "m:DynMember", "2025-04-01", "2025-06-30", 1_540_000_000, "2025-08-01"),
        fact("revenue", "m:DynCloudMember", "2025-04-01", "2025-06-30", 1_626_000_000, "2025-11-01"),
        fact("revenue", "m:DynCloudMember", "2025-07-01", "2025-09-30", 1_700_000_000, "2025-11-01"),
      ],
    });
    expect(built.series.map((entry) => entry.label).sort()).toEqual(["Dynamics", "Dynamics cloud", "XBOX"]);
    expect(built.series.find((entry) => entry.label === "XBOX")!.quarterly.map((point) => point.value)).toEqual([5_000_000_000, 5_200_000_000, 5_400_000_000]);
  });

  it("takes a fourth quarter from the year as filed beside its quarters, not as restated on a new basis", () => {
    const recast = buildSegments({
      ticker: "c", cik: "1", labels: new Map(), filings: [], facts: [
        ...quarters.map(([start, end]) => fact("revenue", "c:CloudMember", start, end, 20_000_000_000, "2025-10-30")),
        fact("revenue", "c:CloudMember", "2025-01-01", "2025-12-31", 82_000_000_000, "2026-02-01"),
        // The next year's report restates the segment on a new basis.
        fact("revenue", "c:CloudMember", "2025-01-01", "2025-12-31", 69_000_000_000, "2027-02-01"),
      ],
    });
    expect(recast.series[0].quarterly.at(-1)).toMatchObject({ end: "2025-12-31", value: 22_000_000_000, derived: true });
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

describe("segment charts for GF", () => {
  const facts: SegmentFact[] = [];
  const ends = [["2024-01-01", "2024-03-31"], ["2024-04-01", "2024-06-30"], ["2024-07-01", "2024-09-30"], ["2024-10-01", "2024-12-31"], ["2025-01-01", "2025-03-31"], ["2025-04-01", "2025-06-30"]];
  ends.forEach(([start, end], index) => {
    facts.push(fact("revenue", "c:CloudMember", start, end, 10 + index, "2025-07-30"), fact("revenue", "c:AdsMember", start, end, 30, "2025-07-30"));
    facts.push(fact("revenue", "c:BetsMember", start, end, 0.5, "2025-07-30"), fact("revenue", null, start, end, 40.5 + index, "2025-07-30"));
    facts.push(fact("operatingIncome", "c:CloudMember", start, end, 2 + index, "2025-07-30"), fact("operatingIncome", "c:AdsMember", start, end, 12, "2025-07-30"));
    facts.push(fact("operatingIncome", "c:BetsMember", start, end, -3, "2025-07-30"));
  });
  facts.push(fact("backlog", "c:CloudMember", null, "2025-03-31", 120, "2025-05-30"), fact("backlog", "c:CloudMember", null, "2025-06-30", 140, "2025-07-30"));
  const data = buildSegments({ ticker: "c", cik: "1", facts, labels: new Map(), filings: [] });
  const charts = segmentCharts(data, "quarterly", "MAX");
  const find = (id: string) => charts.find((entry) => entry.preset.id.startsWith(id));

  it("draws margins by segment, leaving out a slice too small to read", () => {
    const margin = find("seg-margin")!;
    expect(margin.data.series.map((entry) => entry.spec.label)).toEqual(["Ads", "Cloud"]);
    expect(margin.data.series.find((entry) => entry.spec.label === "Cloud")!.values.at(-1)).toBeCloseTo(7 / 15);
  });
  it("draws each line's share of the total and its growth", () => {
    expect(find("seg-mix")!.data.series.find((entry) => entry.spec.label === "Cloud")!.values.at(-1)).toBeCloseTo(15 / 45.5);
    expect(find("seg-growth")!.data.series.find((entry) => entry.spec.label === "Cloud")!.values.at(-1)).toBeCloseTo(15 / 11 - 1);
  });
  it("sets a segment's backlog against its last twelve months of revenue", () => {
    const backlog = find("seg-backlog")!;
    expect(backlog.data.series.find((entry) => entry.spec.id === "coverage")!.values.at(-1)).toBeCloseTo(140 / 54);
  });
});

describe("a segment chart over a company that re-cut its revenue", () => {
  it("draws one breakdown: the latest where it has a year, the longest otherwise", async () => {
    const { coherentRun } = await import("../lib/segments/charts");
    // Two lines for six periods, then two different lines for two.
    const a = [1, 1, 1, 1, 1, 1, null, null];
    const b = [2, 2, 2, 2, 2, 2, null, null];
    const c = [null, null, null, null, null, null, 3, 3];
    const d = [null, null, null, null, null, null, 4, 4];
    expect(coherentRun([a, b, c, d], 8)).toEqual({ from: 0, to: 6 });
    // The latest breakdown with four periods wins over a longer older one.
    const e = [1, 1, 1, 1, 1, 1, null, null, null, null];
    const f = [1, 1, 1, 1, 1, 1, null, null, null, null];
    const g = [null, null, null, null, null, null, 1, 1, 1, 1];
    const h = [null, null, null, null, null, null, 1, 1, 1, 1];
    expect(coherentRun([e, f, g, h], 10)).toEqual({ from: 6, to: 10 });
  });
});

describe("a segment chart with a quarter missing a year back", () => {
  it("starts after the hole, so no line breaks in the middle", async () => {
    const { segmentCharts } = await import("../lib/segments/charts");
    const quarters = ["2023-03-31", "2023-06-30", "2023-09-30", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const line = (id: string, label: string, base: number) => ({
      id, label, measure: "revenue", axis: "business", parent: null, parentLabel: null,
      quarterly: quarters.map((end, index) => ({ end, value: base * (1 + index * 0.02) })), annual: [], instant: [],
    });
    const data = { ticker: "TEST", series: [line("a", "Alpha", 100), line("b", "Beta", 50)], stacks: [] } as never;
    const growth = segmentCharts(data, "quarterly", "MAX").find((chart) => chart.preset.id === "seg-growth");
    expect(growth).toBeDefined();
    for (const series of growth!.data.series) {
      const first = series.values.findIndex((value) => value != null);
      expect(series.values.slice(first).every((value) => value != null)).toBe(true);
    }
  });
});

describe("operating income whose unallocated line stops being tagged", () => {
  // Broadcom: Infrastructure Software, Semiconductor Solutions and Unallocated
  // expenses up to August 2025; the last one only in the table's text after.
  const quarters = [["2025-02-03", "2025-05-04"], ["2025-05-05", "2025-08-03"], ["2025-08-04", "2025-11-02"], ["2025-11-03", "2026-02-01"]];
  const M = 1_000_000;
  const income = (member: string | null, start: string, end: string, value: number) => ({ ...fact("operatingIncome", member, start, end, value * M), concept: "us-gaap:OperatingIncomeLoss" });
  const facts: SegmentFact[] = quarters.flatMap(([start, end], index) => [
    fact("revenue", "avgo:InfrastructureSoftwareMember", start, end, 6_600 * M), fact("revenue", "avgo:SemiconductorSolutionsMember", start, end, 8_400 * M), fact("revenue", null, start, end, 15_000 * M),
    income("avgo:InfrastructureSoftwareMember", start, end, 5_000), income("avgo:SemiconductorSolutionsMember", start, end, 5_000 + index * 1_000),
    ...(index < 2 ? [income("avgo:UnallocatedExpensesMember", start, end, -4_000)] : []),
    income(null, start, end, 6_000 + index * 1_000 - (index < 2 ? 0 : 500)),
  ]);
  const data = buildSegments({ ticker: "AVGO", cik: "1", facts, labels: new Map(), filings: [] });
  const view = segmentViews(data).find((entry) => entry.axis === "business" && !entry.parent)!;

  it("stacks the segments still, the gap to operating income as the residual", () => {
    const stacks = data.stacks.filter((stack) => stack.measure === "operatingIncome" && stack.periodicity === "quarterly");
    expect(stacks.map((stack) => stack.residual)).toEqual([0, 0, -4_500 * M, -4_500 * M]);
  });
  it("draws the unallocated line on through the residual, negative", () => {
    const chart = segmentChart(data, view, "quarterly", "operatingIncome")!;
    expect(chart.reconciled).toBe(true);
    expect(chart.series.find((line) => line.label.startsWith("Unallocated"))?.values).toEqual([-4_000 * M, -4_000 * M, -4_500 * M, -4_500 * M]);
    expect(chart.series.some((line) => line.id === "residual")).toBe(false);
  });
  it("leaves revenue as it was", () => {
    expect(data.stacks.filter((stack) => stack.measure === "revenue").every((stack) => stack.residual === 0)).toBe(true);
  });
});

describe("a seasonal fourth quarter", () => {
  // Reality Labs: headsets sell at Christmas, the fourth quarter near four times the three before it.
  const M = 1_000_000;
  const years = [[2022, [695, 452, 285], 2_159], [2023, [339, 276, 210], 1_896]] as const;
  const facts: SegmentFact[] = years.flatMap(([year, quarters, total]) => [
    ...quarters.map((value, index) => fact("revenue", "meta:RealityLabsMember", `${year}-${String(index * 3 + 1).padStart(2, "0")}-01`, `${year}-${["03-31", "06-30", "09-30"][index]}`, value * M)),
    fact("revenue", "meta:RealityLabsMember", `${year}-01-01`, `${year}-12-31`, total * M, `${year + 1}-02-01`),
  ]);
  const line = buildSegments({ ticker: "META", cik: "1", facts, labels: new Map(), filings: [] }).series.find((entry) => entry.label === "Reality Labs")!;
  it("is kept when it stands near the same quarter a year earlier", () => {
    expect(line.quarterly.filter((quarter) => quarter.derived).map((quarter) => [quarter.end, quarter.value / M])).toEqual([["2022-12-31", 727], ["2023-12-31", 1_071]]);
  });
});

describe("one segment within the loose match of operating income", () => {
  // NVIDIA, July 2025: Compute & Networking alone within 0.4% of operating income, once Corporate stops being tagged.
  const M = 1_000_000;
  const quarters = [["2025-01-27", "2025-04-27"], ["2025-04-28", "2025-07-27"]];
  const income = (member: string | null, start: string, end: string, value: number) => ({ ...fact("operatingIncome", member, start, end, value * M), concept: "us-gaap:OperatingIncomeLoss" });
  const facts: SegmentFact[] = [
    ...quarters.flatMap(([start, end]) => [fact("revenue", "nvda:ComputeMember", start, end, 40_000 * M), fact("revenue", "nvda:GraphicsMember", start, end, 4_000 * M), fact("revenue", null, start, end, 44_000 * M)]),
    income("nvda:ComputeMember", ...quarters[0] as [string, string], 22_054), income("nvda:GraphicsMember", ...quarters[0] as [string, string], 1_640),
    income("us-gaap:CorporateNonSegmentMember", ...quarters[0] as [string, string], -2_056), income(null, ...quarters[0] as [string, string], 21_638),
    income("nvda:ComputeMember", ...quarters[1] as [string, string], 28_363), income("nvda:GraphicsMember", ...quarters[1] as [string, string], 2_242),
    income(null, ...quarters[1] as [string, string], 28_440),
  ];
  const data = buildSegments({ ticker: "NVDA", cik: "1", facts, labels: new Map(), filings: [] });
  it("stacks both segments and the corporate line as the residual", () => {
    const view = segmentViews(data).find((entry) => entry.axis === "business" && !entry.parent)!;
    const chart = segmentChart(data, view, "quarterly", "operatingIncome")!;
    expect(chart.labels).toHaveLength(2);
    expect(chart.series.find((line) => /corporate/i.test(line.label))?.values.map((value) => value! / M)).toEqual([-2_056, -2_165]);
  });
});

describe("a successor's reports, then its predecessor's", () => {
  const report = (accession: string, reportDate: string, cik?: string) => ({ accession, form: "10-Q", reportDate, filed: reportDate, ...(cik ? { cik } : {}) });
  // ExxonMobil Holdings: one 10-Q, filed under Exxon Mobil Corporation too.
  const own = [report("0000034088-26-000093", "2026-06-30")];

  it("fills the rest with the predecessor's reports, read once where both carry one", () => {
    const earlier = [report("0000034088-26-000093", "2026-06-30", "0000034088"), report("0000034088-26-000067", "2026-03-31", "0000034088"), report("0000034088-26-000045", "2025-12-31", "0000034088")];
    const reports = withPredecessor(own, earlier, 24);
    expect(reports.map((item) => item.reportDate)).toEqual(["2026-06-30", "2026-03-31", "2025-12-31"]);
    expect(reports.map((item) => item.cik)).toEqual([undefined, "0000034088", "0000034088"]);
  });

  it("stops at the successor's first report: a predecessor still filing as a subsidiary is another company after it", () => {
    // Apache went on filing under APA; its 2021 quarter is Apache's, not APA's.
    const apa = [report("0001841666-21-000001", "2021-06-30"), report("0001841666-21-000002", "2021-03-31")];
    const apache = [report("0000006769-21-000010", "2021-06-30", "0000006769"), report("0000006769-21-000003", "2020-12-31", "0000006769"), report("0000006769-20-000040", "2020-09-30", "0000006769")];
    expect(withPredecessor(apa, apache, 24).map((item) => item.reportDate)).toEqual(["2021-06-30", "2021-03-31", "2020-12-31", "2020-09-30"]);
    expect(withPredecessor(apa, apache, 3)).toHaveLength(3);
  });

  it("names a predecessor only for members of the index, and agrees with the filer the statements read", () => {
    for (const [ticker, predecessor] of Object.entries(PREDECESSORS)) {
      expect(universeMember(ticker), ticker).not.toBeNull();
      expect(predecessor.cik).toMatch(/^\d{10}$/);
      expect(predecessor.cik, ticker).not.toBe(universeMember(ticker)?.cik);
      expect(predecessor.notice.length, ticker).toBeGreaterThan(10);
    }
    for (const [ticker, known] of Object.entries(KNOWN_SUCCESSORS)) expect(PREDECESSORS[ticker]?.cik, ticker).toBe(known.reads);
  });
});

describe("customers (SPLC)", () => {
  const ctx = (id: string, dims: Array<[string, string]>, period: string) =>
    `<context id="${id}"><entity><identifier scheme="x">1</identifier><segment>${dims.map(([axis, member]) => `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`).join("")}</segment></entity><period>${period}</period></context>`;
  const year = (start: string, end: string) => `<startDate>${start}</startDate><endDate>${end}</endDate>`;
  const TYPE: [string, string] = ["us-gaap:ConcentrationRiskByTypeAxis", "us-gaap:CustomerConcentrationRiskMember"];
  const SALES: [string, string] = ["us-gaap:ConcentrationRiskByBenchmarkAxis", "us-gaap:SalesRevenueNetMember"];
  const RECEIVABLES: [string, string] = ["us-gaap:ConcentrationRiskByBenchmarkAxis", "us-gaap:AccountsReceivableMember"];
  const KO: [string, string] = ["srt:MajorCustomersAxis", "ball:TheCocaColaCompanyMember"];
  /** A trimmed instance in the shape Ball's 10-K writes its customers. */
  const CUSTOMERS = `<?xml version="1.0"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
${ctx("ko25", [TYPE, SALES, KO], year("2025-01-01", "2025-12-31"))}
${ctx("ko24", [TYPE, SALES, KO], year("2024-01-01", "2024-12-31"))}
${ctx("koAr", [TYPE, RECEIVABLES, KO], "<instant>2025-12-31</instant>")}
${ctx("koSeg", [TYPE, SALES, KO, ["us-gaap:StatementBusinessSegmentsAxis", "ball:BeverageNorthAmericaMember"]], year("2025-01-01", "2025-12-31"))}
${ctx("geo", [["us-gaap:ConcentrationRiskByTypeAxis", "us-gaap:GeographicConcentrationRiskMember"], SALES, ["srt:MajorCustomersAxis", "ball:EuropeMember"]], year("2025-01-01", "2025-12-31"))}
${ctx("anon", [TYPE, SALES, ["srt:MajorCustomersAxis", "ball:CustomerAMember"]], year("2025-01-01", "2025-12-31"))}
${ctx("res", [["srt:MajorCustomersAxis", "ball:ResidentialMember"]], year("2025-01-01", "2025-12-31"))}
${ctx("wmt", [["srt:MajorCustomersAxis", "ball:WalmartMember"]], year("2025-01-01", "2025-12-31"))}
${ctx("mkt", [["srt:MajorCustomersAxis", "ball:TechnologyMember"]], year("2025-01-01", "2025-12-31"))}
<unit id="pure"><measure>xbrli:pure</measure></unit>
<unit id="usd"><measure>iso4217:USD</measure></unit>
<us-gaap:ConcentrationRiskPercentage1 contextRef="ko25" unitRef="pure" decimals="2">0.14</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:ConcentrationRiskPercentage1 contextRef="ko24" unitRef="pure" decimals="2">0.13</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:ConcentrationRiskPercentage1 contextRef="koAr" unitRef="pure" decimals="2">0.09</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:ConcentrationRiskPercentage1 contextRef="koSeg" unitRef="pure" decimals="2">0.40</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:ConcentrationRiskPercentage1 contextRef="geo" unitRef="pure" decimals="2">0.30</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:ConcentrationRiskPercentage1 contextRef="anon" unitRef="pure" decimals="2">0.11</us-gaap:ConcentrationRiskPercentage1>
<us-gaap:Revenues contextRef="res" unitRef="usd" decimals="-6">5000000000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="wmt" unitRef="usd" decimals="-6">2000000000</us-gaap:Revenues>
<us-gaap:Revenues contextRef="mkt" unitRef="usd" decimals="-6">3000000000</us-gaap:Revenues>
</xbrl>`;
  const tenK = { accession: "0000009389-26-000010", filed: "2026-02-18", form: "10-K" };
  const companies = [
    { ticker: "KO", name: "Coca-Cola Company (The)", aliases: ["COCA COLA CO"] },
    { ticker: "WMT", name: "Walmart", aliases: ["Walmart Inc.", "WAL MART STORES INC"] },
    { ticker: "VZ", name: "Verizon", aliases: ["VERIZON COMMUNICATIONS INC"] },
    { ticker: "TMUS", name: "T-Mobile US", aliases: ["T-Mobile US, Inc."] },
    { ticker: "T", name: "AT&T", aliases: ["AT&T INC."] },
    { ticker: "SO", name: "Southern Company", aliases: ["SOUTHERN CO"] },
    { ticker: "GM", name: "General Motors", aliases: ["GENERAL MOTORS CO"] },
    { ticker: "GOOGL", name: "Alphabet Inc. (Class A)" },
    { ticker: "GOOG", name: "Alphabet Inc. (Class C)" },
    { ticker: "COR", name: "Cencora", aliases: ["Cencora, Inc.", "AMERISOURCEBERGEN CORP"] },
    { ticker: "BALL", name: "Ball Corporation" },
  ];

  it("reads a customer's share of revenue and of receivables, and nothing scoped to a segment or another kind of concentration", () => {
    const facts = parseCustomerFacts(CUSTOMERS, tenK);
    const shares = facts.filter((fact) => fact.measure === "share");
    expect(shares.map((fact) => `${fact.member} ${fact.benchmark} ${fact.end} ${fact.value}`).sort()).toEqual([
      "ball:CustomerAMember revenue 2025-12-31 0.11",
      "ball:TheCocaColaCompanyMember receivables 2025-12-31 0.09",
      "ball:TheCocaColaCompanyMember revenue 2024-12-31 0.13",
      "ball:TheCocaColaCompanyMember revenue 2025-12-31 0.14",
    ]);
    expect(facts.filter((fact) => fact.measure === "revenue").map((fact) => fact.member).sort()).toEqual(["ball:ResidentialMember", "ball:TechnologyMember", "ball:WalmartMember"]);
  });

  it("keeps named, unnamed and linked customers, and drops classes and revenue no filing called a concentration", () => {
    const labels = new Map([["ball:TheCocaColaCompanyMember", "The Coca-Cola Company"], ["ball:CustomerAMember", "Customer A"], ["ball:WalmartMember", "Walmart Inc."], ["ball:TechnologyMember", "Technology"], ["ball:ResidentialMember", "Residential"]]);
    const customers = buildCustomers(parseCustomerFacts(CUSTOMERS, tenK), labels, companies, { self: "BALL", totals: new Map([["2025-12-31", 12_000_000_000]]) });
    expect(customers.map((customer) => [customer.label, customer.kind, customer.ticker])).toEqual([
      ["Walmart Inc.", "named", "WMT"],
      ["The Coca-Cola Company", "named", "KO"],
      ["Customer A", "unnamed", null],
    ]);
    const ko = customers.find((customer) => customer.ticker === "KO")!;
    expect(ko.annual.map((point) => [point.end, point.share])).toEqual([["2024-12-31", 0.13], ["2025-12-31", 0.14]]);
    expect(ko.receivables).toEqual([{ end: "2025-12-31", share: 0.09, accession: tenK.accession }]);
    // Walmart's share is worked out from its revenue and the company's, and says so.
    const walmart = customers.find((customer) => customer.ticker === "WMT")!.annual[0];
    expect(walmart.share).toBeCloseTo(2 / 12, 6);
    expect(walmart.derived).toBe(true);
  });

  it("tells a named customer from an unnamed one, a group and a class", () => {
    const cases: Array<[string, string]> = [
      ["Customer A", "unnamed"], ["Customer1", "unnamed"], ["Major Customer One", "unnamed"], ["Second Largest Customer", "unnamed"],
      ["One Customer", "unnamed"], ["Distributor 2", "unnamed"], ["Reseller B", "unnamed"], ["Top Customer One", "unnamed"], ["One Holding Company", "unnamed"],
      ["Ten Largest Customers", "group"], ["Top10 Customers", "group"], ["Three Customer", "group"], ["Four Distributors", "group"], ["Three Largest US Wholesale Customers", "group"],
      ["Residential", "class"], ["Manufacturing Customers", "class"], ["Other Customers", "class"], ["Non-US Government", "class"], ["No customer", "class"],
      ["Walmart Inc.", "named"], ["AT&T Mobility", "named"], ["Red Bull GmbH and affiliates", "named"], ["U.S. Government", "named"],
      ["Taiwan Semiconductor Manufacturing Company Limited", "named"], ["Public Works and Government Services Canada", "named"],
    ];
    for (const [label, kind] of cases) expect([label, customerKind(label)]).toEqual([label, kind]);
  });

  it("links a customer only by a member's name, never by resemblance", () => {
    expect(matchCompany("Verizon Wireless", companies)).toBe("VZ");
    expect(matchCompany("AT&T Mobility", companies)).toBe("T");
    expect(matchCompany("T-Mobile", companies)).toBe("TMUS");
    expect(matchCompany("Wal-Mart Stores, Inc.", companies)).toBe("WMT");
    expect(matchCompany("Walmart Stores Inc", companies)).toBe("WMT");
    expect(matchCompany("Walmart Inc. and Affiliates", companies)).toBe("WMT");
    expect(matchCompany("AmerisourceBergen Corporation", companies)).toBe("COR");
    expect(matchCompany("The Coca-Cola Company", companies)).toBe("KO");
    expect(matchCompany("Alphabet Inc.", companies)).toBe("GOOG");
    expect(matchCompany("Southern California Edison", companies)).toBeNull();
    expect(matchCompany("General Dynamics", companies)).toBeNull();
    expect(matchCompany("Coca-Cola Europacific Partners", companies)).toBeNull();
    expect(matchCompany("Verizon and AT&T", companies)).toBeNull();
  });

  it("turns each company's named customers round into the customer's suppliers", () => {
    const labels = new Map([["ball:TheCocaColaCompanyMember", "The Coca-Cola Company"], ["ball:CustomerAMember", "Customer A"], ["ball:WalmartMember", "Walmart Inc."]]);
    const edges = edgesOf(buildCustomers(parseCustomerFacts(CUSTOMERS, tenK), labels, companies, { self: "BALL", totals: new Map([["2025-12-31", 12_000_000_000]]) }));
    // Only index members, each with its latest figures; Customer A links to no one.
    expect(edges).toEqual([["WMT", 0.1667, "2025-12-31", null, null], ["KO", 0.14, "2025-12-31", 0.09, "2025-12-31"]]);
    expect(JSON.stringify({ e: edges }).length).toBeLessThan(1024);
    const index = new Map([["BALL", edges], ["CCEP", [["KO", 0.2, "2025-12-31", null, null]] as Edge[]], ["X", []]]);
    expect(suppliersFrom(index, "KO").map((supplier) => [supplier.ticker, supplier.share])).toEqual([["CCEP", 0.2], ["BALL", 0.14]]);
    expect(suppliersFrom(index, "PEP")).toEqual([]);
  });

  it("knows every member of the index under the names it files under", () => {
    for (const member of UNIVERSE) expect(FILED_NAMES[member.ticker]?.length, member.ticker).toBeGreaterThan(0);
  });
});

describe("customers across renamed members", () => {
  it("joins a customer filed under two members, and reads labels written without the link prefix", () => {
    const labels = parseLabels(`<linkbase xmlns="http://www.xbrl.org/2003/linkbase">
<loc xlink:type="locator" xlink:href="ball-20251231.xsd#ball_TheCocaColaCompanyMember" xlink:label="ball_TheCocaColaCompanyMember" />
<labelArc xlink:type="arc" xlink:from="ball_TheCocaColaCompanyMember" xlink:to="ball_TheCocaColaCompanyMember_lbl" />
<label xlink:type="resource" xlink:role="http://www.xbrl.org/2003/role/documentation" xlink:label="ball_TheCocaColaCompanyMember_lbl">Represents information pertaining to the bottlers.</label>
<label xlink:type="resource" xlink:role="http://www.xbrl.org/2003/role/label" xlink:label="ball_TheCocaColaCompanyMember_lbl">Coca-Cola Bottlers' Sales &amp; Services Company LLC and affiliates</label>
<loc xlink:type="locator" xlink:href="ball-20221231.xsd#ball_CokeBottlersMember" xlink:label="ball_CokeBottlersMember" />
<labelArc xlink:type="arc" xlink:from="ball_CokeBottlersMember" xlink:to="ball_CokeBottlersMember_lbl" />
<label xlink:type="resource" xlink:role="http://www.xbrl.org/2003/role/label" xlink:label="ball_CokeBottlersMember_lbl">Coca-Cola Bottlers' Sales &amp; Services Company LLC and Affiliates</label>
</linkbase>`);
    expect(labels.get("ball:TheCocaColaCompanyMember")).toBe("Coca-Cola Bottlers' Sales & Services Company LLC and affiliates");
    const fact = (member: string, end: string, value: number, filed: string): CustomerFact => ({ member, measure: "share", benchmark: "revenue", start: `${end.slice(0, 4)}-01-01`, end, value, currency: null, accession: filed, filed, form: "10-K" });
    const customers = buildCustomers([
      fact("ball:CokeBottlersMember", "2021-12-31", 0.1, "2022-02-20"),
      fact("ball:CokeBottlersMember", "2022-12-31", 0.12, "2023-02-20"),
      fact("ball:TheCocaColaCompanyMember", "2022-12-31", 0.13, "2025-02-20"),
      fact("ball:TheCocaColaCompanyMember", "2024-12-31", 0.14, "2025-02-20"),
    ], labels, [{ ticker: "KO", name: "Coca-Cola Company (The)", aliases: ["COCA COLA CO"] }], { self: "BALL" });
    expect(customers).toHaveLength(1);
    // The bottlers' cooperative is not The Coca-Cola Company: no link.
    expect(customers[0].ticker).toBeNull();
    expect(customers[0].member).toBe("ball:TheCocaColaCompanyMember");
    // A year filed twice takes the later filing's figure.
    expect(customers[0].annual.map((point) => [point.end.slice(0, 4), point.share])).toEqual([["2021", 0.1], ["2022", 0.13], ["2024", 0.14]]);
  });
});

describe("the cuts a period's revenue flows from", () => {
  const point = (end: string, value: number) => ({ start: null, end, value, accession: "a" });
  const line = (id: string, label: string, axis: "business" | "geography", value: number) => ({
    id, measure: "revenue", axis, member: id, label, parent: null, parentLabel: null, quarterly: [point("2026-06-30", value)], annual: [], instant: [],
  });
  const stack = (axis: "business" | "geography", ids: string[], total: number, residual: number) => ({
    measure: "revenue", axis, parent: null, periodicity: "quarterly", start: "2026-04-01", end: "2026-06-30", total, ids, residual,
  });

  it("gives each cut the filing reconciles at that quarter, its lines largest first and its entities decoded", () => {
    const data = {
      ticker: "WMT", series: [line("us", "Walmart U.S.", "business", 126), line("sams", "Sam's&#160;Club U.S.", "business", 26), line("intl", "Walmart International", "business", 36),
        line("dom", "U.S.", "geography", 150), line("for", "Other countries", "geography", 39)],
      stacks: [stack("business", ["us", "sams", "intl"], 188, 0), stack("geography", ["dom", "for"], 188, -1)],
    } as never;
    const cuts = revenueCuts(data, "2026-06-30", "quarterly");
    expect(cuts.map((cut) => cut.title)).toEqual(["By segment"]);
    expect(cuts[0].lines.map((entry) => entry.label)).toEqual(["Walmart U.S.", "Walmart International", "Sam's Club U.S."]);
    expect(revenueCuts(data, "2025-06-30", "quarterly")).toEqual([]);
  });
});
