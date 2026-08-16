import { describe, expect, it } from "vitest";
import { alignMixedSeries, fundamentalObservations, marketObservations, movingAverage, updateSeriesDefinition, visibleRawObservations } from "../lib/mixed-series";
import { analyzeVisibleSeries } from "../lib/series-analysis";
import type { CompanyDataset, MarketBar, SeriesObservation } from "../lib/types";

const fact=(metric:string,value:number,periodEnd:string,periodicity:"annual"|"quarterly"|"ttm")=>({metric,value,currency:"USD",unit:metric.includes("Shares")?"shares":"currency",periodEnd,periodicity,fiscalYear:2025,provenance:{provider:"SEC",sourceUrl:"sec",retrievedAt:"2026-01-01",concept:metric,status:"reported"}} as never);
const dataset={company:{name:"Test",ticker:"T",cik:"1",exchange:"X",currency:"USD",sector:"",description:""},retrievedAt:"2026-01-01",warnings:[],periods:[
  {label:"FY",fiscalYear:2025,periodEnd:"2025-12-31",periodicity:"annual",filingDate:"2026-02-01",accession:"a",currency:"USD",facts:{revenue:fact("revenue",100,"2025-12-31","annual"),dilutedShares:fact("dilutedShares",10,"2025-12-31","annual")}},
  {label:"TTM",fiscalYear:2025,periodEnd:"2025-12-31",periodicity:"ttm",filingDate:"2026-02-01",accession:"b",currency:"USD",facts:{operatingCashFlow:fact("operatingCashFlow",30,"2025-12-31","ttm"),capitalExpenditures:fact("capitalExpenditures",-10,"2025-12-31","ttm"),dilutedShares:fact("dilutedShares",10,"2025-12-31","ttm")}},
]} as CompanyDataset;
const obs=(date:string,value:number,frequency:"weekly"|"ttm"="weekly"):SeriesObservation=>({date,value,frequency,currency:"USD",unit:"perShare",source:"test",status:"Verified",rawObservation:true});

describe("mixed-frequency series engine",()=>{
  it("uses adjusted close for stock-price observations",()=>{const bars=[{date:"2026-01-02",periodStart:"2025-12-27",open:9,high:11,low:8,close:10,adjustedClose:8,volume:1,currency:"USD",ticker:"T",frequency:"weekly",sourceUrl:"yahoo"}] as MarketBar[];expect(marketObservations(bars,"stockPrice","weekly")[0].value).toBe(8)});
  it("positions fundamentals at fiscal end or public filing date",()=>{expect(fundamentalObservations(dataset,"revenuePerShare","annual","fiscal-period")[0].date).toBe("2025-12-31");expect(fundamentalObservations(dataset,"revenuePerShare","annual","as-reported")[0].date).toBe("2026-02-01")});
  it("combines weekly price and TTM without manufacturing weekly fundamentals",()=>{const price=[obs("2026-02-06",20),obs("2026-02-13",21)];const ttm=[obs("2026-02-01",2,"ttm")];const rows=alignMixedSeries([{definition:{id:"price",ticker:"T",metric:"stockPrice",frequency:"weekly",missingData:"report-points"},observations:price},{definition:{id:"fcf",ticker:"T",metric:"freeCashFlowPerShare",frequency:"ttm",missingData:"report-points"},observations:ttm}]);expect(rows).toHaveLength(3);expect(rows.find((row)=>row.date==="2026-02-06")?.cells.fcf).toBeNull();expect(ttm).toHaveLength(1)});
  it("step mode carries only display cells and exposes age",()=>{const source=[obs("2026-02-01",2,"ttm")];const rows=alignMixedSeries([{definition:{id:"fcf",ticker:"T",metric:"freeCashFlowPerShare",frequency:"ttm",missingData:"step-until-next-report"},observations:source},{definition:{id:"price",ticker:"T",metric:"stockPrice",frequency:"weekly",missingData:"report-points"},observations:[obs("2026-02-08",20)]}]);expect(rows.at(-1)?.cells.fcf).toMatchObject({value:2,carried:true,ageDays:7});expect(source).toHaveLength(1);expect(visibleRawObservations(source,"2026-01-01","2026-03-01")).toHaveLength(1)});
  it("calculates each CAGR from that series's raw endpoints, never carried display cells",()=>{const weekly=[obs("2025-01-03",100),obs("2026-01-02",121)],ttm=[obs("2025-03-31",10,"ttm"),obs("2026-03-31",11,"ttm")];const rows=alignMixedSeries([{definition:{id:"price",ticker:"T",metric:"stockPrice",frequency:"weekly",missingData:"report-points"},observations:weekly},{definition:{id:"fcf",ticker:"T",metric:"freeCashFlowPerShare",frequency:"ttm",missingData:"step-until-next-report"},observations:ttm}]);expect(rows.filter((row)=>row.cells.fcf?.carried)).not.toHaveLength(0);expect(analyzeVisibleSeries(weekly,"cagr").value).toBeCloseTo(.21,2);expect(analyzeVisibleSeries(ttm,"cagr").value).toBeCloseTo(.1,3)});
  it("changes one series frequency without mutating any peer",()=>{const definitions=[{id:"price",ticker:"T",metric:"stockPrice",frequency:"weekly" as const,missingData:"report-points" as const},{id:"revenue",ticker:"T",metric:"revenue",frequency:"annual" as const,missingData:"report-points" as const}];const updated=updateSeriesDefinition(definitions,"price",{frequency:"monthly"});expect(updated[0].frequency).toBe("monthly");expect(updated[1]).toEqual(definitions[1]);expect(definitions[0].frequency).toBe("weekly")});
  it("aligns monthly price, quarterly margin and annual revenue only on real dates",()=>{const definitions=[{definition:{id:"price",ticker:"T",metric:"stockPrice",frequency:"monthly" as const,missingData:"report-points" as const},observations:[obs("2026-01-31",20),obs("2026-02-28",22)]},{definition:{id:"margin",ticker:"T",metric:"freeCashFlowMargin",frequency:"quarterly" as const,missingData:"report-points" as const},observations:[{...obs("2026-02-15",.2),frequency:"quarterly" as const}]},{definition:{id:"revenue",ticker:"T",metric:"revenue",frequency:"annual" as const,missingData:"report-points" as const},observations:[{...obs("2026-02-01",100),frequency:"annual" as const}]}];const rows=alignMixedSeries(definitions);expect(rows.map((row)=>row.date)).toEqual(["2026-01-31","2026-02-01","2026-02-15","2026-02-28"]);expect(rows.find((row)=>row.date==="2026-02-28")?.cells.margin).toBeNull()});
});

describe("a market observation carries the session, not just its close", () => {
  const bar = {
    date: "2026-01-30", periodStart: "2026-01-01", open: 100, high: 120, low: 90, close: 110,
    adjustedClose: 108, volume: null, currency: "USD", ticker: "T", frequency: "monthly" as const, sourceUrl: "yahoo",
  };

  it("keeps the open, high and low beside the value a line draws", () => {
    const [observation] = marketObservations([bar], "stockPrice", "monthly");
    // The line wants the dividend-adjusted close; a candle wants the raw four,
    // so both travel and neither is derived from the other.
    expect(observation.value).toBe(108);
    expect([observation.open, observation.high, observation.low]).toEqual([100, 120, 90]);
  });

  it("still yields an observation when the provider reports no range", () => {
    const [observation] = marketObservations([{ ...bar, open: null, high: null, low: null }], "stockPrice", "monthly");
    expect(observation.value).toBe(108);
    expect(observation.high).toBeNull();
  });
});

describe("moving averages over the drawn sessions", () => {
  const sessions = (values: Array<number | null>) => values.map((value, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`, value, frequency: "daily" as const,
    currency: "USD", unit: "perShare", source: "Yahoo Finance", status: "Market data" as const, rawObservation: true as const,
  }));

  it("averages the window ending at each session", () => {
    const line = movingAverage(sessions([1, 2, 3, 4, 5]), 3);
    expect(line).toEqual([null, null, 2, 3, 4]);
  });

  it("leaves the opening sessions empty rather than averaging a shorter window", () => {
    // A mean of two points drawn as if it were a mean of two hundred starts the
    // line steep for a reason that is not in the data.
    const line = movingAverage(sessions([10, 20, 30]), 200);
    expect(line.every((value) => value === null)).toBe(true);
  });

  it("refuses a window straddling a gap instead of averaging around it", () => {
    const line = movingAverage(sessions([1, 2, null, 4, 5, 6]), 3);
    expect(line[2]).toBeNull();
    expect(line[3]).toBeNull();
    expect(line[4]).toBeNull();
    expect(line[5]).toBeCloseTo(5, 10);
  });

  it("returns one value per session, so it lines up with the price", () => {
    expect(movingAverage(sessions([1, 2, 3, 4]), 2)).toHaveLength(4);
    expect(movingAverage([], 20)).toEqual([]);
  });
});
