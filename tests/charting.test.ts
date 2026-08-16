import { describe,expect,it } from "vitest";
import { CHART_PALETTE,chartDomain,logTicks } from "../lib/charting";

describe("truthful chart semantics",()=>{
  it("starts positive absolute data at zero",()=>expect(chartDomain([90,100,110],"zero").domain[0]).toBe(0));
  it("includes negative minimum, zero and positive maximum",()=>{const domain=chartDomain([-20,0,50],"zero").domain as [number,number];expect(domain[0]).toBeLessThanOrEqual(-20);expect(domain[1]).toBeGreaterThanOrEqual(50)});
  it("keeps auto scale explicit",()=>expect(chartDomain([90,100],"auto").domain).toEqual(["auto","auto"]));
  it("validates custom ranges",()=>expect(chartDomain([1,2],"custom",{min:10,max:5}).warning).toMatch(/lower/));
  it("rejects log scale for zero or negative data",()=>expect(chartDomain([0,5],"log").warning).toMatch(/positive/));
  it("provides eight named, unique preset colors",()=>{expect(CHART_PALETTE).toHaveLength(8);expect(new Set(CHART_PALETTE.map((color)=>color.value)).size).toBe(8);expect(new Set(CHART_PALETTE.map((color)=>color.name)).size).toBe(8)});

  // The palette this replaced came from a dark theme the interface no longer
  // has. Its most-used slot measured 1.11:1 against white, so the first line on
  // every chart was one the reader could barely see. Contrast is computable, so
  // it is asserted rather than trusted.
  it("keeps every series color legible on the white chart surface",()=>{
    const channel=(part:number)=>{const c=part/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};
    const contrast=(hex:string)=>{
      const [r,g,b]=[1,3,5].map((at)=>channel(parseInt(hex.slice(at,at+2),16)));
      return 1.05/(0.2126*r+0.7152*g+0.0722*b+0.05);
    };
    for(const color of CHART_PALETTE) expect(contrast(color.value),`${color.name} ${color.value}`).toBeGreaterThan(2);
  });
});

describe("ticks for a logarithmic axis", () => {
  it("climbs by 1, 2 and 5 across decades", () => {
    const ticks = logTicks(1, 1_000);
    expect(ticks[0]).toBe(1);
    expect(ticks.at(-1)).toBe(1_000);
    expect(ticks.every((value) => /^[125]0*$/.test(String(value)))).toBe(true);
  });

  it("uses readable linear steps inside a single decade", () => {
    // A price that ran from 300 to 650 gets one rung of the ladder, at 500,
    // and an axis with a single tick is an axis with no scale on it.
    const ticks = logTicks(300, 650);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0]).toBeLessThanOrEqual(300);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(650);
  });

  it("never offers a tick a logarithm cannot take", () => {
    expect(logTicks(0, 100)).toEqual([]);
    expect(logTicks(-5, 100)).toEqual([]);
    expect(logTicks(100, 100)).toEqual([]);
    expect(logTicks(1, 10_000).every((value) => value > 0)).toBe(true);
  });

  it("stays readable over four decades", () => {
    expect(logTicks(1, 10_000).length).toBeLessThanOrEqual(9);
  });
});
