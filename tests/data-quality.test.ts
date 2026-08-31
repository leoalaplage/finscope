import { describe,expect,it } from "vitest";
import { normalizeSecPayload } from "../lib/adapters/sec";
import { validateCompanyDataset, validatedDerivedValue, validationForMetric } from "../lib/data-quality";
import { APPLE_DATASET } from "../lib/demo-data";
import type { CompanyDataset, FinancialPeriod, MetricKey, NormalizedFact } from "../lib/types";

function period(year:number,shares=100):FinancialPeriod{const make=(metric:MetricKey,value:number):NormalizedFact=>({metric,value,currency:"USD",unit:metric.includes("Shares")||metric==="dilutedShares"?"shares":"currency",periodEnd:`${year}-12-31`,periodicity:"annual",fiscalYear:year,provenance:{provider:"SEC",sourceUrl:"https://sec.test",retrievedAt:"2026-08-13",concept:metric,status:"reported"}});return {label:`FY ${year}`,fiscalYear:year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,periodicity:"annual",filingDate:`${year+1}-02-01`,accession:"a",currency:"USD",facts:{revenue:make("revenue",1000),operatingCashFlow:make("operatingCashFlow",200),capitalExpenditures:make("capitalExpenditures",50),dilutedShares:make("dilutedShares",shares)}}}
function dataset(periods:FinancialPeriod[]):CompanyDataset{return {company:{name:"Test",ticker:"TEST",cik:"1",exchange:"X",currency:"USD",sector:"",description:""},periods,retrievedAt:"2026-08-13T00:00:00Z",warnings:[]}}

describe("central data validation",()=>{
  it("verifies formulas and preserves suspected share anomalies",()=>{const checked=validateCompanyDataset(dataset([period(2024,100),period(2025,100_000)]));expect(checked.periods[1].facts.dilutedShares?.validation?.status).toBe("Suspected anomaly");expect(validatedDerivedValue(checked.periods[1],"freeCashFlowPerShare")).toBeCloseTo(.0015);expect(checked.quality?.issues[0].action).toMatch(/retained/i)});
  it("creates a gap for confirmed invalid dependencies in validated mode but exposes raw mode",()=>{const item=period(2025);item.facts.dilutedShares!.validation={status:"Confirmed invalid",reason:"unit",rawValue:100,normalizedValue:null,checkedAt:"now"};expect(validatedDerivedValue(item,"freeCashFlowPerShare","validated")).toBeNull();expect(validatedDerivedValue(item,"freeCashFlowPerShare","raw")).toBe(1.5);expect(validationForMetric(item,"freeCashFlowPerShare").reason).toContain("dilutedShares")});
  it("reports missing dependencies exactly",()=>{const item=period(2025);delete item.facts.capitalExpenditures;expect(validationForMetric(item,"freeCashFlow").status).toBe("Missing");expect(validationForMetric(item,"freeCashFlow").reason).toContain("capitalExpenditures")});
});

describe("offline fixture identity", () => {
  it("labels the Apple fixture as Apple, not whichever company sits first in the watchlist", () => {
    expect(APPLE_DATASET.company.ticker).toBe("AAPL");
    expect(APPLE_DATASET.company.cik).toBe("0000320193");
    // The rows are Apple filings; the accession numbers must agree with the profile.
    const accessions = APPLE_DATASET.periods.map((period) => period.accession);
    expect(accessions.some((accession) => accession.startsWith("0000320193-"))).toBe(true);
  });
});

describe("a filer that is not American", () => {
  it("reads its statements in the currency it reports them in", () => {
    /*
     * ASML files 623 US GAAP concepts on Form 20-F and reports every one of
     * them in euros. A company resolved from the SEC's ticker registry is
     * assumed to report in dollars — that registry says nothing about currency
     * — so every unit lookup missed and the company came back with no
     * financial statements at all and a 200 status.
     */
    const facts = {
      "us-gaap": {
        Revenues: { units: { EUR: [
          { end: "2025-12-31", start: "2025-01-01", val: 32_700_000_000, accn: "0000-1", fy: 2025, fp: "FY", form: "20-F", filed: "2026-02-11" },
        ] } },
        NetIncomeLoss: { units: { EUR: [
          { end: "2025-12-31", start: "2025-01-01", val: 9_000_000_000, accn: "0000-1", fy: 2025, fp: "FY", form: "20-F", filed: "2026-02-11" },
        ] } },
      },
    };
    const profile = { ...APPLE_DATASET.company, ticker: "ASML", name: "ASML HOLDING NV", cik: "0000937966", currency: "USD", stockSplits: undefined };
    const dataset = normalizeSecPayload({ entityName: "ASML HOLDING NV", facts }, "ASML", "2026-08-29T00:00:00.000Z", profile);
    expect(dataset.company.currency).toBe("EUR");
    const annual = dataset.periods.filter((period) => period.periodicity === "annual");
    expect(annual).toHaveLength(1);
    expect(annual[0].facts.revenue?.value).toBe(32_700_000_000);
    expect(annual[0].facts.revenue?.currency).toBe("EUR");
    // Stated, never converted: a price in one currency over a filed amount in
    // another is wrong in a way that looks entirely plausible. The warning now
    // describes a refusal rather than a caution — see fail-closed.test.ts for
    // the figures it withholds.
    expect(dataset.warnings.some((warning) => warning.includes("withheld rather than computed across two currencies"))).toBe(true);
  });

  it("is not fooled by a handful of foreign-currency amounts", () => {
    /*
     * The exact shape that beat the first attempt. ASML files five dollar
     * amounts — hedging notionals, purchase commitments — among nine thousand
     * eight hundred euro ones, and a rule of "prefer the declared currency
     * wherever it appears" chose dollars and matched nothing.
     */
    const many = (unit: string, count: number) => ({ units: { [unit]: Array.from({ length: count }, (unused, index) => (
      { end: `${2010 + index}-12-31`, start: `${2010 + index}-01-01`, val: 1_000 + index, accn: `0000-${index}`, fy: 2010 + index, fp: "FY", form: "20-F", filed: `${2011 + index}-02-11` }
    )) } });
    const facts = {
      "us-gaap": {
        Revenues: many("EUR", 6),
        NetIncomeLoss: many("EUR", 6),
        NotionalAmountOfForeignCurrencyDerivatives: many("USD", 3),
      },
    };
    const profile = { ...APPLE_DATASET.company, ticker: "ASML", name: "ASML", cik: "0000937966", currency: "USD", stockSplits: undefined };
    const dataset = normalizeSecPayload({ entityName: "ASML", facts }, "ASML", "2026-08-29T00:00:00.000Z", profile);
    expect(dataset.company.currency).toBe("EUR");
    expect(dataset.periods.filter((period) => period.periodicity === "annual")).toHaveLength(6);
  });

  it("keeps a domestic filer exactly as it was", () => {
    expect(APPLE_DATASET.company.currency).toBe("USD");
  });

  it("refuses a company that normalizes to nothing rather than serving it empty", () => {
    // This is what "the search finds it but then there is no data" was: an
    // empty dataset with a 200, so the application had no error to report.
    const ifrs = { entityName: "Taiwan Semiconductor", facts: { "ifrs-full": { Revenue: { units: { TWD: [] } } } } };
    expect(() => normalizeSecPayload(ifrs, "TSM", "2026-08-29T00:00:00.000Z", { ...APPLE_DATASET.company, ticker: "TSM", cik: "0001046179" }))
      .toThrow(/IFRS/);
  });
});
