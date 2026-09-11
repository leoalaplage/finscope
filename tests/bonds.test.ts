import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  DAILY_NO_INTRADAY, dailyWindow, drawsDaily, latestReading, parseBdeCsv, parseBocJson, parseBoeSpotSheet,
  parseBundesbankCsv, parseEcbCsv, parseMofCsv, parseRbaCsv, recentOnly, splitCsvLine, type Observation,
} from "../lib/adapters/daily-yields";
import { BONDS, bondById } from "../lib/bonds";
import { COMMODITIES, commodityById } from "../lib/commodities";
import { mergeReadings } from "../lib/daily-yield-store";
import { readZipText, zipEntries } from "../lib/zip";
import { toggleOpen } from "../components/io/QuoteCharts";

/**
 * What governments pay to borrow, on a page that showed shares and metal.
 *
 * Every valuation on this site starts from a risk-free rate. These rows are
 * where that rate comes from, and the shape of it — three months against
 * thirty years, Tokyo against London — is the most watched reading in finance.
 */
describe("the government yields a market page carries", () => {
  it("carries two sets of six: the reference curves, then the other large markets", () => {
    expect(BONDS.filter((bond) => bond.set === "core").map((bond) => bond.id)).toEqual(["US3M", "US5Y", "US10Y", "US30Y", "EU2Y", "EU10Y"]);
    expect(BONDS.filter((bond) => bond.set === "world").map((bond) => bond.id)).toEqual(["DE10Y", "UK10Y", "JP10Y", "ES10Y", "CA10Y", "AU10Y"]);
  });

  it("leaves out France and Italy rather than filling them with a stale figure", () => {
    /*
     * Not an oversight, and the reason is written into the registry: the
     * Banque de France publishes the French ten-year daily only behind a
     * registered key, and Italy's is not published daily in any form this
     * site can read. The nearest figure for either is a monthly average a
     * month behind, and a monthly average in a row of daily readings is the
     * substitution this application does not make.
     */
    expect(BONDS.some((bond) => /FR|IT|france|italy/i.test(bond.id + bond.label))).toBe(false);
  });

  it("takes every yield outside the US from the institution that strikes it", () => {
    const sources = BONDS.filter((bond) => bond.feed.kind !== "yahoo").map((bond) => bond.feed.kind);
    expect(sources).toEqual(["ecb", "ecb", "bundesbank", "boe", "mof", "bde", "boc", "rba"]);
  });

  it("says which readings move during the session and which are struck once a day", () => {
    // A reader who is not told that will read a date that never changes as a
    // broken feed.
    for (const bond of BONDS) expect(bond.live, bond.id).toBe(bond.feed.kind === "yahoo");
  });

  it("never calls the euro-area curve the Bund, and never calls the Bund the euro area", () => {
    for (const bond of BONDS.filter((each) => each.feed.kind === "ecb")) {
      expect(bond.label + bond.description).not.toMatch(/bund|german/i);
      expect(bond.description).toMatch(/triple-A/);
    }
    expect(bondById("DE10Y")!.description).toMatch(/Bund/);
  });

  it("gives every line a description, because a tenor alone says nothing", () => {
    for (const bond of BONDS) expect(bond.description.length, bond.label).toBeGreaterThan(20);
  });

  it("finds a line by the id its URL carries, whatever the case", () => {
    expect(bondById("us10y")?.label).toBe("US 10-year");
    expect(bondById("uk10y")?.feed.kind).toBe("boe");
    expect(bondById("FR10Y")).toBeNull();
  });

  it("shares no id with the commodities, because one route resolves both", () => {
    expect(BONDS.filter((bond) => commodityById(bond.id))).toEqual([]);
    expect(COMMODITIES.filter((item) => bondById(item.id))).toEqual([]);
  });
});

/**
 * Seven publishers, six ways of writing a date.
 *
 * Every parser finds its column by name and treats every publisher's own way
 * of saying "no reading" as nothing rather than as nought.
 */
describe("reading each publisher's format", () => {
  it("splits a CSV line on commas outside quotes only", () => {
    expect(splitCsvLine('"a, b",2,"c ""d"""')).toEqual(["a, b", "2", 'c "d"']);
  });

  it("reads the ECB's columns wherever they sit, and skips a blank observation", () => {
    const header = "KEY,FREQ,TIME_PERIOD,OBS_VALUE";
    expect(parseEcbCsv([header, "YC,B,2026-09-08,", "YC,B,2026-09-09,3.42"].join("\n"))).toEqual([{ date: "2026-09-09", value: 3.42 }]);
    expect(parseEcbCsv(["OBS_VALUE,TIME_PERIOD", "3.5,2026-09-09"].join("\n"))).toEqual([{ date: "2026-09-09", value: 3.5 }]);
    expect(parseEcbCsv("A,B\n1,2")).toEqual([]);
  });

  it("reads the Bundesbank past its metadata, and reads '.' as no value", () => {
    const text = ['"",BBSIS.D.I…', "unit,Prozent,", "last update,2026-09-10 12:51:20,", "2026-09-06,.,No value available", "2026-09-10,3.51,"].join("\n");
    expect(parseBundesbankCsv(text)).toEqual([{ date: "2026-09-10", value: 3.51 }]);
  });

  it("reads Japan's dates written 2026/9/10 and finds the tenor by heading", () => {
    const text = ["Interest Rate (September 2026),,,(Unit : %)", "Date,1Y,10Y,30Y", "2026/9/1,1.527,2.9,3.99", "2026/9/10,1.55,2.92,-"].join("\n");
    expect(parseMofCsv(text, "10Y")).toEqual([{ date: "2026-09-01", value: 2.9 }, { date: "2026-09-10", value: 2.92 }]);
    // A dash is a missing reading, not a yield.
    expect(parseMofCsv(text, "30Y")).toEqual([{ date: "2026-09-01", value: 3.99 }]);
  });

  it("reads Banco de España's Spanish month names and '_' for none", () => {
    const text = ['"CÓDIGO DE LA SERIE",D_A,D_G0B1F0ZP', '"FRECUENCIA","DIARIA","DIARIA"', '"08 AGO 2026",1.0,"_"', '"09 SEP 2026",2.4,3.824'].join("\n");
    expect(parseBdeCsv(text, "D_G0B1F0ZP")).toEqual([{ date: "2026-09-09", value: 3.824 }]);
  });

  it("reads the Bank of Canada's Valet answer", () => {
    const payload = { observations: [{ d: "2026-09-08", "BD.CDN.10YR.DQ.YLD": { v: "3.81" } }, { d: "2026-09-09", "BD.CDN.10YR.DQ.YLD": { v: "3.84" } }, { d: "2026-09-10" }] };
    expect(parseBocJson(payload, "BD.CDN.10YR.DQ.YLD")).toEqual([{ date: "2026-09-08", value: 3.81 }, { date: "2026-09-09", value: 3.84 }]);
  });

  it("finds the RBA's column by its Series ID row, below the descriptions", () => {
    const text = [
      "F2 CAPITAL MARKET YIELDS – GOVERNMENT BONDS",
      'Description,"Yields, interpolated, 2 years","Yields, interpolated, 10 years"',
      "Series ID,FCMYGBAG2D,FCMYGBAG10D",
      "20-May-2013,,3.229",
      "09-Sep-2026,4.835,5.202",
    ].join("\n");
    expect(parseRbaCsv(text, "FCMYGBAG10D")).toEqual([{ date: "2013-05-20", value: 3.229 }, { date: "2026-09-09", value: 5.202 }]);
    expect(parseRbaCsv(text, "FCMYGBAG2D")).toEqual([{ date: "2026-09-09", value: 4.835 }]);
  });

  it("reads the Bank of England's spot sheet by its 'years:' row, not by position", () => {
    // A note row above and a shared-strings table, as the Bank's workbook has.
    const strings = "<sst><si><t>UK nominal spot curve</t></si><si><t>years:</t></si></sst>";
    const sheet = [
      '<row r="1"><c r="B1" t="s"><v>0</v></c></row>',
      '<row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4"><v>5</v></c><c r="C4"><v>10</v></c><c r="D4"><v>10.5</v></c></row>',
      '<row r="5"><c r="A5" t="e"><v>#VALUE!</v></c></row>',
      '<row r="6"><c r="A6"><v>46266</v></c><c r="B6"><v>4.6</v></c><c r="C6"><v>5.2067</v></c><c r="D6"><v>5.25</v></c></row>',
      '<row r="7"><c r="A7"><v>46267</v></c><c r="B7"><v>4.7</v></c><c r="C7" s="2"/><c r="D7"><v>5.29</v></c></row>',
    ].join("");
    expect(parseBoeSpotSheet(sheet, strings, "10")).toEqual([{ date: "2026-09-01", value: 5.2067 }]);
    expect(parseBoeSpotSheet(sheet, strings, "5").map((each) => each.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(parseBoeSpotSheet(sheet, strings, "40")).toEqual([]);
  });
});

/**
 * The smallest ZIP that exercises the reader: the directory at the end, one
 * entry stored and one deflated, as a spreadsheet writer produces them.
 */
function makeZip(files: Array<{ name: string; text: string; deflate: boolean }>): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = encoder.encode(file.text);
    const data = file.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(8, file.deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(10, file.deflate ? 8 : 0, true);
    central.setUint32(20, data.length, true); central.setUint32(24, raw.length, true); central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out.buffer;
}

describe("opening the Bank of England's archive", () => {
  const archive = makeZip([
    { name: "GLC Real daily data current month.xlsx", text: "real", deflate: false },
    { name: "xl/worksheets/sheet5.xml", text: "<worksheet>spot</worksheet>".repeat(50), deflate: true },
  ]);

  it("lists what the directory at the end of the archive names", () => {
    expect(zipEntries(archive).map((entry) => [entry.name, entry.method])).toEqual([
      ["GLC Real daily data current month.xlsx", 0], ["xl/worksheets/sheet5.xml", 8],
    ]);
  });

  it("reads a stored entry and a deflated one", async () => {
    expect(await readZipText(archive, (name) => name.startsWith("GLC Real"))).toBe("real");
    expect(await readZipText(archive, (name) => name.endsWith("sheet5.xml"))).toBe("<worksheet>spot</worksheet>".repeat(50));
    expect(await readZipText(archive, (name) => name === "absent")).toBeNull();
  });

  it("refuses something that is not an archive rather than reading noise", () => {
    expect(() => zipEntries(new TextEncoder().encode("not a zip at all, just text").buffer as ArrayBuffer)).toThrow(/Not a ZIP/);
  });
});

/**
 * What a strip and a chart make of the readings.
 */
describe("a daily series as a figure and as a line", () => {
  // Business days across fourteen months, at a yield that climbs a basis
  // point a day, so every window's opening level is predictable.
  const series: Observation[] = [];
  for (let day = new Date(Date.UTC(2025, 6, 1)); day <= new Date(Date.UTC(2026, 8, 10)); day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    series.push({ date: day.toISOString().slice(0, 10), value: 3 + series.length / 100 });
  }

  it("states the latest reading and the move from the one before", () => {
    const latest = latestReading(series)!;
    expect(latest.date).toBe("2026-09-10");
    expect(latest.rate - latest.previous!).toBeCloseTo(.01, 10);
    expect(latestReading([])).toBeNull();
  });

  it("measures a month from the last reading before the month opened", () => {
    const window = dailyWindow(series, "Test", "1M", "T");
    expect(window.points[0].label).toBe("2026-08-11");
    // The tenth of August was a Monday, so it is the last reading on or
    // before the opening date and the dashed line sits there.
    expect(window.baseline).toBe(series.find((each) => each.date === "2026-08-10")!.value);
    expect(window.open).toBe(false);
  });

  it("counts five sessions in sessions, as every other panel does", () => {
    const window = dailyWindow(series, "Test", "5D", "T");
    expect(window.points).toHaveLength(5);
    expect(window.baseline).toBe(series.at(-6)!.value);
  });

  it("refuses a single session rather than drawing a one-point line", () => {
    expect(drawsDaily("1D")).toBe(false);
    expect(() => dailyWindow(series, "Test", "1D", "T")).toThrow(DAILY_NO_INTRADAY);
  });

  it("refuses a window the series does not reach rather than drawing it short", () => {
    // Fourteen months of readings can draw a year and cannot draw five: a
    // five-year heading on fourteen months' move would be a false label.
    expect(dailyWindow(series, "Test", "1Y", "T").points.length).toBeGreaterThan(250);
    expect(() => dailyWindow(series, "Test", "5Y", "T")).toThrow(/reaches back only to 2025-07-01/);
  });

  it("keeps what a forgetting feed has shown, the later word winning", () => {
    expect(recentOnly({ kind: "boe", maturity: "10" })).toBe(true);
    expect(recentOnly({ kind: "ecb", key: "x" })).toBe(false);
    const kept = [{ date: "2026-08-27", value: 5.1 }, { date: "2026-08-28", value: 5.14 }];
    const fresh = [{ date: "2026-08-28", value: 5.15 }, { date: "2026-09-01", value: 5.2 }];
    expect(mergeReadings(kept, fresh)).toEqual([
      { date: "2026-08-27", value: 5.1 }, { date: "2026-08-28", value: 5.15 }, { date: "2026-09-01", value: 5.2 },
    ]);
  });
});

/**
 * Which charts are open, which is the whole of the interaction.
 */
describe("opening a cell into a chart", () => {
  it("opens what was closed and closes what was open", () => {
    expect(toggleOpen([], "BRENT")).toEqual(["BRENT"]);
    expect(toggleOpen(["BRENT"], "BRENT")).toEqual([]);
  });

  it("keeps three, and drops the one opened longest ago", () => {
    expect(toggleOpen(["BRENT", "WTI", "GOLD"], "COPPER")).toEqual(["WTI", "GOLD", "COPPER"]);
  });

  it("closing a middle one leaves the order of the rest alone", () => {
    expect(toggleOpen(["BRENT", "WTI", "GOLD"], "WTI")).toEqual(["BRENT", "GOLD"]);
  });
});
