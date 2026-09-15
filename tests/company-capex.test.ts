import { describe, expect, it } from "vitest";
import { companyCapexLine, investingLines, parseXbrlInstance } from "../lib/adapters/xbrl-instance";

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
