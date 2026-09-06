export interface MacroSeriesDefinition {
  id: string;
  series: string;
  label: string;
  note: string;
  frequency: "Daily" | "Monthly";
  unit: "percent" | "percentage-points";
  decimals: number;
  sourceUrl: string;
}

export interface MacroObservation {
  date: string;
  value: number;
}

export interface MacroIndicator extends MacroSeriesDefinition {
  value: number | null;
  date: string | null;
  error?: string;
}

/**
 * A compact US macro dashboard sourced directly from the agencies that publish
 * the underlying figures. Frequencies remain explicit so a daily rate is never
 * presented as though it arrived with a monthly labour release.
 */
export const MACRO_SERIES: MacroSeriesDefinition[] = [
  { id: "cpi", series: "CUUR0000SA0", label: "CPI inflation", note: "Year over year", frequency: "Monthly", unit: "percent", decimals: 1, sourceUrl: "https://data.bls.gov/timeseries/CUUR0000SA0" },
  { id: "fed-funds", series: "EFFR", label: "Fed funds", note: "Effective rate", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://www.newyorkfed.org/markets/reference-rates/effr" },
  { id: "treasury-10y", series: "BC_10YEAR", label: "US 10Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "curve", series: "BC_10YEAR-BC_2YEAR", label: "10Y − 2Y curve", note: "Treasury spread", frequency: "Daily", unit: "percentage-points", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "unemployment", series: "LNS14000000", label: "Unemployment", note: "Seasonally adjusted", frequency: "Monthly", unit: "percent", decimals: 1, sourceUrl: "https://data.bls.gov/timeseries/LNS14000000" },
  { id: "wages", series: "CES0500000003", label: "Wage growth", note: "Hourly earnings · YoY", frequency: "Monthly", unit: "percent", decimals: 1, sourceUrl: "https://data.bls.gov/timeseries/CES0500000003" },
];

export function latestObservation(observations: MacroObservation[]): MacroObservation | null {
  return [...observations].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}

/** The latest monthly level against the same month one year earlier. */
export function yearOverYearObservation(observations: MacroObservation[]): MacroObservation | null {
  const current = latestObservation(observations);
  if (!current || current.value === 0) return null;
  const [year, month] = current.date.split("-");
  const priorPrefix = `${Number(year) - 1}-${month}-`;
  const prior = observations.find((observation) => observation.date.startsWith(priorPrefix));
  if (!prior || prior.value === 0) return null;
  return { date: current.date, value: (current.value / prior.value - 1) * 100 };
}

interface BlsPoint { year?: string; period?: string; value?: string }

/** Convert a BLS monthly series response to normal ISO-dated observations. */
export function parseBlsObservations(points: BlsPoint[]): MacroObservation[] {
  return points.flatMap((point) => {
    const month = point.period?.match(/^M(0[1-9]|1[0-2])$/)?.[1];
    const value = Number(point.value);
    return point.year && month && Number.isFinite(value)
      ? [{ date: `${point.year}-${month}-01`, value }]
      : [];
  });
}

/** Read the latest 2Y and 10Y yields from the Treasury's Atom XML feed. */
export function parseTreasuryCurve(xml: string): { date: string; twoYear: number; tenYear: number } | null {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  const parsed = entries.flatMap((entry) => {
    const body = entry[1];
    const date = body.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})T/)?.[1];
    const twoYear = Number(body.match(/<d:BC_2YEAR[^>]*>([^<]+)</)?.[1]);
    const tenYear = Number(body.match(/<d:BC_10YEAR[^>]*>([^<]+)</)?.[1]);
    return date && Number.isFinite(twoYear) && Number.isFinite(tenYear)
      ? [{ date, twoYear, tenYear }]
      : [];
  });
  return parsed.sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}
