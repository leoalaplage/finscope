import { describe,expect,it } from "vitest";
import { CHART_PALETTE,chartDomain } from "../lib/charting";

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
