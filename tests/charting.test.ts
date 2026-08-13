import { describe,expect,it } from "vitest";
import { CHART_PALETTE,chartDomain,convertHistoricalCurrency,indexedTo100 } from "../lib/charting";

describe("truthful chart semantics",()=>{
  it("starts positive absolute data at zero",()=>expect(chartDomain([90,100,110],"zero").domain[0]).toBe(0));
  it("includes negative minimum, zero and positive maximum",()=>{const domain=chartDomain([-20,0,50],"zero").domain as [number,number];expect(domain[0]).toBeLessThanOrEqual(-20);expect(domain[1]).toBeGreaterThanOrEqual(50)});
  it("keeps auto scale explicit",()=>expect(chartDomain([90,100],"auto").domain).toEqual(["auto","auto"]));
  it("validates custom ranges",()=>expect(chartDomain([1,2],"custom",{min:10,max:5}).warning).toMatch(/lower/));
  it("rejects log scale for zero or negative data",()=>expect(chartDomain([0,5],"log").warning).toMatch(/positive/));
  it("provides exactly ten named, unique preset colors",()=>{expect(CHART_PALETTE).toHaveLength(10);expect(new Set(CHART_PALETTE.map((color)=>color.value)).size).toBe(10);expect(CHART_PALETTE.map((color)=>color.name)).toContain("Fluorescent yellow")});
  it("indexes multiple-company series to a common base of 100",()=>expect(indexedTo100([null,20,30,40])).toEqual([null,100,150,200]));
  it("converts only with a verified historical rate",()=>{expect(convertHistoricalCurrency(100,1.1)).toBeCloseTo(110);expect(convertHistoricalCurrency(100,null)).toBeNull()});
});
