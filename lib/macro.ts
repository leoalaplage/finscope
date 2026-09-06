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
 * A compact view of the US policy rate and Treasury curve. Frequencies remain
 * explicit so the section can later accept monthly macro releases without
 * presenting them as though they arrived with the daily rates.
 */
export const MACRO_SERIES: MacroSeriesDefinition[] = [
  { id: "fed-funds", series: "EFFR", label: "Fed funds", note: "Effective rate", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://www.newyorkfed.org/markets/reference-rates/effr" },
  { id: "treasury-3m", series: "BC_3MONTH", label: "US 3M yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "treasury-2y", series: "BC_2YEAR", label: "US 2Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "treasury-10y", series: "BC_10YEAR", label: "US 10Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "treasury-30y", series: "BC_30YEAR", label: "US 30Y yield", note: "Treasury par yield", frequency: "Daily", unit: "percent", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
  { id: "curve", series: "BC_10YEAR-BC_2YEAR", label: "10Y − 2Y curve", note: "Treasury spread", frequency: "Daily", unit: "percentage-points", decimals: 2, sourceUrl: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
];

export interface TreasuryRates {
  date: string;
  threeMonth: number;
  twoYear: number;
  tenYear: number;
  thirtyYear: number;
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
