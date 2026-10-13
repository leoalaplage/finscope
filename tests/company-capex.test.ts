import { describe, expect, it } from "vitest";
import { companyCapexLine, investingLines, parseXbrlInstance } from "../lib/adapters/xbrl-instance";
import { capexWithConstruction, operationsAsOperatingActivities, revenueFromParts } from "../lib/adapters/sec";

// Cut from ConocoPhillips' June 2026 10-Q calculation linkbase, cop-20260630_cal.xml.
const COP_CALCULATION = `<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
<link:calculationLink xlink:role="http://www.conocophillips.com/role/CashFlows" xlink:type="extended">
<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2026/elts/us-gaap-2026.xsd#us-gaap_NetCashProvidedByUsedInInvestingActivities" xlink:label="loc_investing"/>
<link:loc xlink:type="locator" xlink:href="cop-20260630.xsd#cop_PaymentToAcquireProductiveAssetsAndInvestments" xlink:label="loc_capex"/>
<link:loc xlink:type="locator" xlink:href="https://xbrl.fasb.org/us-gaap/2026/elts/us-gaap-2026.xsd#us-gaap_ProceedsFromSaleOfProductiveAssets" xlink:label="loc_proceeds"/>
<link:loc xlink:type="locator" xlink:href="cop-20260630.xsd#cop_IncreaseDecreaseInCapitalAccrual" xlink:label="loc_accrual"/>
<link:calculationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/summation-item" xlink:from="loc_investing" xlink:to="loc_capex" weight="-1.0" order="1"/>
<link:calculationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/summation-item" xlink:from="loc_investing" xlink:to="loc_proceeds" weight="1.0" order="2"/>
<link:calculationArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/summation-item" xlink:from="loc_investing" xlink:to="loc_accrual" weight="1.0" order="3"/>
</link:calculationLink>
</link:linkbase>`;

// NextEra's June 2026 linkbase names three capital-expenditure lines of its own.
const NEE_CALCULATION = COP_CALCULATION
  .replace("cop-20260630.xsd#cop_PaymentToAcquireProductiveAssetsAndInvestments", "nee-20260630.xsd#nee_CapitalExpendituresOfFPL")
  .replace("</link:calculationLink>", `<link:loc xlink:type="locator" xlink:href="nee-20260630.xsd#nee_CapitalExpendituresOfPublicUtilitiesFPLConsolidated" xlink:label="loc_second"/>
<link:calculationArc xlink:type="arc" xlink:from="loc_investing" xlink:to="loc_second" weight="-1.0"/>
</link:calculationLink>`);

describe("a company's own capital-expenditure line, on the filing's own arithmetic", () => {
  it("finds the lines a filing adds into investing activities, with their signs", () => {
    const lines = investingLines(COP_CALCULATION);
    expect(lines.map((line) => `${line.prefix}:${line.name} ${line.weight}`)).toEqual([
      "cop:PaymentToAcquireProductiveAssetsAndInvestments -1",
      "us-gaap:ProceedsFromSaleOfProductiveAssets 1",
      "cop:IncreaseDecreaseInCapitalAccrual 1",
    ]);
  });

  it("accepts ConocoPhillips' single capital-expenditure line", () => {
    expect(companyCapexLine(investingLines(COP_CALCULATION))).toMatchObject({ prefix: "cop", name: "PaymentToAcquireProductiveAssetsAndInvestments" });
  });

  it("reads nothing where a company files more than one such line", () => {
    expect(companyCapexLine(investingLines(NEE_CALCULATION))).toBeNull();
  });

  it("reads that line's facts out of the filing under the company's own prefix", () => {
    const instance = `<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:cop="http://www.conocophillips.com/20260630" xmlns:dei="http://xbrl.sec.gov/dei/2026">
      <context id="c1"><entity><identifier scheme="http://www.sec.gov/CIK">0001163165</identifier></entity><period><startDate>2026-01-01</startDate><endDate>2026-06-30</endDate></period></context>
      <unit id="usd"><measure>iso4217:USD</measure></unit>
      <dei:DocumentFiscalYearFocus contextRef="c1">2026</dei:DocumentFiscalYearFocus>
      <dei:DocumentFiscalPeriodFocus contextRef="c1">Q2</dei:DocumentFiscalPeriodFocus>
      <cop:PaymentToAcquireProductiveAssetsAndInvestments contextRef="c1" unitRef="usd" decimals="-6">6100000000</cop:PaymentToAcquireProductiveAssetsAndInvestments>
    </xbrl>`;
    const tree = parseXbrlInstance(instance, { accession: "0001163165-26-000032", form: "10-Q", filed: "2026-08-06" }, "cop");
    expect(tree.cop.PaymentToAcquireProductiveAssetsAndInvestments.units.USD[0]).toMatchObject({ start: "2026-01-01", end: "2026-06-30", val: 6_100_000_000, fy: 2026, fp: "Q2" });
  });
});

// Suncor's 2024 40-F: an IFRS investing total, its capital line, and a held-for-sale line beside it.
const SU_CALCULATION = `<linkbase xmlns="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink"><calculationLink>
<loc xlink:type="locator" xlink:href="https://xbrl.ifrs.org/full_ifrs-cor.xsd#ifrs-full_CashFlowsFromUsedInInvestingActivities" xlink:label="ifrs-full_CashFlowsFromUsedInInvestingActivities_1" />
<loc xlink:type="locator" xlink:href="su-20241231.xsd#su_CashFlowsUsedForCapitalAndExplorationExpenditures" xlink:label="su_CashFlowsUsedForCapitalAndExplorationExpenditures_1" />
<loc xlink:type="locator" xlink:href="su-20241231.xsd#su_CashFlowsUsedForCapitalExpendituresClassifiedAsHeldForSale" xlink:label="su_CashFlowsUsedForCapitalExpendituresClassifiedAsHeldForSale_1" />
<calculationArc xlink:type="arc" xlink:from="ifrs-full_CashFlowsFromUsedInInvestingActivities_1" xlink:to="su_CashFlowsUsedForCapitalAndExplorationExpenditures_1" weight="-1" />
<calculationArc xlink:type="arc" xlink:from="ifrs-full_CashFlowsFromUsedInInvestingActivities_1" xlink:to="su_CashFlowsUsedForCapitalExpendituresClassifiedAsHeldForSale_1" weight="-1" />
</calculationLink></linkbase>`;

describe("an IFRS filer's own capital line", () => {
  it("reads the line under an IFRS investing total, and never a held-for-sale one", () => {
    expect(investingLines(SU_CALCULATION)).toHaveLength(2);
    expect(companyCapexLine(investingLines(SU_CALCULATION))?.concept).toBe("su_CashFlowsUsedForCapitalAndExplorationExpenditures");
  });
});

describe("an IFRS operating cash flow tagged as cash flows from operations", () => {
  const year = (val: number) => [{ start: "2024-01-01", end: "2024-12-31", val, accn: "a", fy: 2024, fp: "FY", form: "40-F", filed: "2025-02-27" }];
  const tree = (operations: number) => ({ "ifrs-full": {
    CashFlowsFromUsedInOperations: { units: { CAD: year(operations) } },
    CashFlowsFromUsedInInvestingActivities: { units: { CAD: year(-6472e6) } },
    CashFlowsFromUsedInFinancingActivities: { units: { CAD: year(-7882e6) } },
    IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges: { units: { CAD: year(1606e6) } },
  } });

  it("is the operating cash flow where the three sections add up to the change in cash with it", () => {
    expect(operationsAsOperatingActivities(tree(15960e6))["ifrs-full"].CashFlowsFromUsedInOperatingActivities?.units.CAD[0].val).toBe(15960e6);
  });

  it("is not, where something was paid below it", () => {
    expect(operationsAsOperatingActivities(tree(17500e6))["ifrs-full"].CashFlowsFromUsedInOperatingActivities).toBeUndefined();
  });
});

describe("revenue filed as goods and services, before the contracts standard", () => {
  const fact = (start: string, end: string, val: number, accn = "a") => ({ start, end, val, accn, fy: 2016, fp: "FY", form: "10-K", filed: "2017-02-01" });
  const tree = (goodsLater: number) => ({ "us-gaap": {
    SalesRevenueGoodsNet: { units: { USD: [fact("2016-01-01", "2016-03-31", 636.9e6), fact("2016-01-01", "2016-12-31", 2685.9e6), fact("2018-04-01", "2018-06-30", goodsLater, "b")] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fact("2016-01-01", "2016-12-31", 2685.9e6, "c"), fact("2018-04-01", "2018-06-30", 9421e6, "b")] } },
  } });

  it("reads the parts where they give the filer's own total back, up to the first period they do not", () => {
    // Coca-Cola: its goods line was all its revenue until 2018, and a component of it after.
    const units = revenueFromParts(tree(8927e6)).company?.RevenueFromGoodsAndServices?.units.USD ?? [];
    expect(units.map((each) => each.end).sort()).toEqual(["2016-03-31", "2016-12-31"]);
  });

  it("reads nothing where the parts never met a total", () => {
    const lone = { "us-gaap": { SalesRevenueGoodsNet: { units: { USD: [fact("2016-01-01", "2016-03-31", 636.9e6)] } } } };
    expect(revenueFromParts(lone).company).toBeUndefined();
  });
});

describe("construction expenditure beside a smaller standard line", () => {
  const raw = (concept: string, start: string, end: string, value: number, accession = "a") => ({
    metric: "capitalExpenditures" as const, value, currency: "USD", unit: "currency" as const, start, end, filed: "2024-02-20", accession,
    fiscalYear: 2023, fiscalPeriod: "FY" as const, form: "10-K" as const, concept: `us-gaap:${concept}`, sourceUrl: "", retrievedAt: "",
  });

  it("adds the two where the standard line is the smaller, and reads construction alone where it stands alone", () => {
    // American Electric Power: $7.4bn of construction beside $155m under the standard name.
    const standard = raw("PaymentsToAcquireProductiveAssets", "2023-01-01", "2023-12-31", 155e6);
    const { replaced, added } = capexWithConstruction([standard], [
      raw("PaymentsForConstructionInProcess", "2023-01-01", "2023-12-31", 7378.3e6),
      raw("PaymentsForConstructionInProcess", "2022-01-01", "2022-12-31", 6671.7e6, "b"),
    ]);
    expect(replaced.has(standard)).toBe(true);
    expect(added.map((fact) => [fact.end, fact.value])).toEqual([["2023-12-31", 7533.3e6], ["2022-12-31", 6671.7e6]]);
  });

  it("leaves a standard line that is the larger, which may already hold construction", () => {
    const standard = raw("PaymentsToAcquirePropertyPlantAndEquipment", "2023-01-01", "2023-12-31", 9e9);
    const { replaced, added } = capexWithConstruction([standard], [raw("PaymentsForConstructionInProcess", "2023-01-01", "2023-12-31", 2e9)]);
    expect(replaced.size).toBe(0);
    expect(added).toEqual([]);
  });
});
