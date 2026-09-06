export type MacroFrequency = "Daily" | "Monthly" | "Quarterly" | "Annual";
export type MacroUnit = "percent" | "percentage-points" | "index";

export interface MacroCountry {
  code: string;
  name: string;
  worldBank: string;
  oecd?: string;
  eurostat?: string;
  ecb?: boolean;
}

export interface MacroSeriesDefinition {
  id: string;
  label: string;
  note: string;
  frequency: MacroFrequency;
  unit: MacroUnit;
  decimals: number;
}

export interface MacroObservation {
  date: string;
  value: number;
}

interface BlsPoint { year?: string; period?: string; value?: string }

/** Convert a BLS monthly series response to chronological observations. */
export function parseBlsObservations(points: BlsPoint[]): MacroObservation[] {
  return points.flatMap((point) => {
    const month = point.period?.match(/^M(0[1-9]|1[0-2])$/)?.[1];
    const value = Number(point.value);
    return point.year && month && Number.isFinite(value) ? [{ date: `${point.year}-${month}`, value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Turn monthly index levels into a year-over-year rate for every comparable month. */
export function yearOverYearObservations(observations: MacroObservation[]): MacroObservation[] {
  const levels = new Map(observations.map((point) => [point.date, point.value]));
  return observations.flatMap((point) => {
    const [year, month] = point.date.split("-");
    const prior = levels.get(`${Number(year) - 1}-${month}`);
    return prior && point.value !== 0 ? [{ date: point.date, value: (point.value / prior - 1) * 100 }] : [];
  });
}

export interface MacroIndicator extends MacroSeriesDefinition {
  value: number | null;
  date: string | null;
  source: string;
  sourceUrl: string;
  error?: string;
}

export interface MacroHistory {
  country: Pick<MacroCountry, "code" | "name">;
  indicator: MacroSeriesDefinition & { source: string; sourceUrl: string };
  observations: MacroObservation[];
  error?: string;
}

export const MACRO_COUNTRIES: MacroCountry[] = [
  { code: "US", name: "United States", worldBank: "USA", oecd: "USA" },
  { code: "EA", name: "Euro area", worldBank: "EMU", eurostat: "EA21", ecb: true },
  { code: "FR", name: "France", worldBank: "FRA", oecd: "FRA", eurostat: "FR", ecb: true },
  { code: "DE", name: "Germany", worldBank: "DEU", oecd: "DEU", eurostat: "DE", ecb: true },
  { code: "IT", name: "Italy", worldBank: "ITA", oecd: "ITA", eurostat: "IT", ecb: true },
  { code: "ES", name: "Spain", worldBank: "ESP", oecd: "ESP", eurostat: "ES", ecb: true },
  { code: "GB", name: "United Kingdom", worldBank: "GBR", oecd: "GBR" },
  { code: "JP", name: "Japan", worldBank: "JPN", oecd: "JPN" },
  { code: "CN", name: "China", worldBank: "CHN", oecd: "CHN" },
  { code: "CA", name: "Canada", worldBank: "CAN", oecd: "CAN" },
];

export const COMMON_MACRO_SERIES: MacroSeriesDefinition[] = [
  { id: "inflation", label: "Inflation", note: "Consumer prices · year over year", frequency: "Monthly", unit: "percent", decimals: 1 },
  { id: "gdp-growth", label: "GDP growth", note: "Real output · quarter over quarter", frequency: "Quarterly", unit: "percent", decimals: 1 },
  { id: "unemployment", label: "Unemployment", note: "Share of labour force", frequency: "Monthly", unit: "percent", decimals: 1 },
  { id: "current-account", label: "Current account", note: "Balance as a share of GDP", frequency: "Annual", unit: "percent", decimals: 1 },
];

export const US_RATE_SERIES: MacroSeriesDefinition[] = [
  { id: "fed-funds", label: "Fed funds", note: "Effective rate", frequency: "Daily", unit: "percent", decimals: 2 },
  { id: "treasury-3m", label: "US 3M yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2 },
  { id: "treasury-2y", label: "US 2Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2 },
  { id: "treasury-10y", label: "US 10Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2 },
  { id: "treasury-30y", label: "US 30Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2 },
  { id: "curve", label: "10Y − 2Y curve", note: "Treasury spread", frequency: "Daily", unit: "percentage-points", decimals: 2 },
];

export const ECB_RATE_SERIES: MacroSeriesDefinition = {
  id: "ecb-rate",
  label: "ECB deposit rate",
  note: "Deposit facility",
  frequency: "Daily",
  unit: "percent",
  decimals: 2,
};

export const OECD_SERIES: MacroSeriesDefinition = {
  id: "oecd-cli",
  label: "Leading indicator",
  note: "OECD composite · trend = 100",
  frequency: "Monthly",
  unit: "index",
  decimals: 1,
};

export const EUROSTAT_SERIES = [
  {
    definition: { ...COMMON_MACRO_SERIES[0], frequency: "Monthly" as const },
    dataset: "prc_hicp_minr",
    parameters: "coicop18=TOTAL&unit=RCH_A",
  },
  {
    definition: { ...COMMON_MACRO_SERIES[1], note: "Real output · quarter over quarter", frequency: "Quarterly" as const },
    dataset: "namq_10_gdp",
    parameters: "s_adj=SCA&na_item=B1GQ&unit=CLV_PCH_PRE",
  },
  {
    definition: { ...COMMON_MACRO_SERIES[2], frequency: "Monthly" as const },
    dataset: "une_rt_m",
    parameters: "s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT",
  },
] as const;

export function eurostatUrls(dataset: string, geo: string, parameters: string, frequency: MacroFrequency) {
  const year = new Date().getUTCFullYear() - 2;
  const since = frequency === "Quarterly" ? `${year}-Q1` : `${year}-01`;
  return {
    api: `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?geo=${geo}&${parameters}&sinceTimePeriod=${since}`,
    source: `https://ec.europa.eu/eurostat/databrowser/view/${dataset}/default/table?lang=en`,
  };
}

/** Definitions in their stable visual order for the selected geography. */
export function macroDefinitionsFor(countryCode: string): MacroSeriesDefinition[] {
  const country = MACRO_COUNTRIES.find((candidate) => candidate.code === countryCode) ?? MACRO_COUNTRIES[0];
  return [
    ...COMMON_MACRO_SERIES,
    ...(country.code === "US" ? US_RATE_SERIES : []),
    ...(country.ecb ? [ECB_RATE_SERIES] : []),
    ...(country.oecd ? [OECD_SERIES] : []),
  ];
}

export interface TreasuryRates {
  date: string;
  threeMonth: number;
  twoYear: number;
  tenYear: number;
  thirtyYear: number;
}

export type TreasurySeriesId = "treasury-3m" | "treasury-2y" | "treasury-10y" | "treasury-30y" | "curve";

/** Every complete curve in a Treasury Atom XML feed, in chronological order. */
export function parseTreasuryHistory(xml: string, series: TreasurySeriesId): MacroObservation[] {
  const field: Record<Exclude<TreasurySeriesId, "curve">, string> = {
    "treasury-3m": "BC_3MONTH",
    "treasury-2y": "BC_2YEAR",
    "treasury-10y": "BC_10YEAR",
    "treasury-30y": "BC_30YEAR",
  };
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((entry) => {
    const body = entry[1];
    const date = body.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})T/)?.[1];
    const read = (name: string) => Number(body.match(new RegExp(`<d:${name}[^>]*>([^<]+)</`))?.[1]);
    const value = series === "curve" ? read("BC_10YEAR") - read("BC_2YEAR") : read(field[series]);
    return date && Number.isFinite(value) ? [{ date, value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Read the latest complete curve from the Treasury's Atom XML feed. */
export function parseTreasuryRates(xml: string): TreasuryRates | null {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  const parsed = entries.flatMap((entry) => {
    const body = entry[1];
    const date = body.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})T/)?.[1];
    const threeMonth = Number(body.match(/<d:BC_3MONTH[^>]*>([^<]+)</)?.[1]);
    const twoYear = Number(body.match(/<d:BC_2YEAR[^>]*>([^<]+)</)?.[1]);
    const tenYear = Number(body.match(/<d:BC_10YEAR[^>]*>([^<]+)</)?.[1]);
    const thirtyYear = Number(body.match(/<d:BC_30YEAR[^>]*>([^<]+)</)?.[1]);
    return date && [threeMonth, twoYear, tenYear, thirtyYear].every(Number.isFinite)
      ? [{ date, threeMonth, twoYear, tenYear, thirtyYear }]
      : [];
  });
  return parsed.sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}

/** Latest non-null annual observation returned by the World Bank API. */
export function parseWorldBankObservation(payload: unknown): MacroObservation | null {
  return parseWorldBankObservations(payload).at(-1) ?? null;
}

/** All populated annual observations returned by the World Bank API. */
export function parseWorldBankObservations(payload: unknown): MacroObservation[] {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
  const observations = payload[1] as Array<{ date?: unknown; value?: unknown }>;
  return observations.flatMap((observation) => {
    const value = Number(observation.value);
    if (typeof observation.date === "string" && observation.value != null && Number.isFinite(value)) {
      return [{ date: observation.date, value }];
    }
    return [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

interface EurostatPayload {
  value?: Record<string, number>;
  dimension?: { time?: { category?: { index?: Record<string, number> } } };
}

/** Latest populated time cell in a Eurostat JSON-stat response. */
export function parseEurostatObservation(payload: unknown): MacroObservation | null {
  return parseEurostatObservations(payload).at(-1) ?? null;
}

/** All populated time cells in a Eurostat JSON-stat response. */
export function parseEurostatObservations(payload: unknown): MacroObservation[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as EurostatPayload;
  const time = data.dimension?.time?.category?.index;
  if (!time || !data.value) return [];
  return Object.entries(time)
    .flatMap(([date, index]) => {
      const value = Number(data.value?.[String(index)]);
      return Number.isFinite(value) ? [{ date, value }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A small CSV reader which is sufficient for the official ECB/OECD exports. */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = []; field = "";
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

/** Read the latest TIME_PERIOD / OBS_VALUE pair from an SDMX CSV export. */
export function parseSdmxCsvObservation(csv: string): MacroObservation | null {
  return parseSdmxCsvObservations(csv).at(-1) ?? null;
}

/** All TIME_PERIOD / OBS_VALUE pairs from an SDMX CSV export. */
export function parseSdmxCsvObservations(csv: string): MacroObservation[] {
  const [header, ...rows] = parseCsvRows(csv);
  if (!header) return [];
  const timeIndex = header.indexOf("TIME_PERIOD");
  const valueIndex = header.indexOf("OBS_VALUE");
  if (timeIndex < 0 || valueIndex < 0) return [];
  return rows.flatMap((row) => {
    const value = Number(row[valueIndex]);
    return row[timeIndex] && Number.isFinite(value) ? [{ date: row[timeIndex], value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
