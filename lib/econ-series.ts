/** The official BLS series behind the calendar's headline figures, and which event each one is the history of. Pure: shared by the server (lib/econ.ts) and the ECO screen. */

/**
 * The official series behind the headline figures: one BLS series, read as a
 * rate on a year earlier or on the month before, as the monthly change, or as
 * printed. `id` is the series and its reading.
 */
export const BLS_SERIES = [
  { id: "CUUR0000SA0", bls: "CUUR0000SA0", label: "CPI, y/y", transform: "yoy", unit: "percent" },
  { id: "CUSR0000SA0", bls: "CUSR0000SA0", label: "CPI, m/m", transform: "mom", unit: "percent" },
  { id: "CUUR0000SA0L1E", bls: "CUUR0000SA0L1E", label: "Core CPI, y/y", transform: "yoy", unit: "percent" },
  { id: "CUSR0000SA0L1E", bls: "CUSR0000SA0L1E", label: "Core CPI, m/m", transform: "mom", unit: "percent" },
  { id: "WPUFD4", bls: "WPUFD4", label: "PPI final demand, y/y", transform: "yoy", unit: "percent" },
  { id: "WPSFD4", bls: "WPSFD4", label: "PPI final demand, m/m", transform: "mom", unit: "percent" },
  { id: "WPUFD49104", bls: "WPUFD49104", label: "Core PPI, y/y", transform: "yoy", unit: "percent" },
  { id: "WPSFD49104", bls: "WPSFD49104", label: "Core PPI, m/m", transform: "mom", unit: "percent" },
  { id: "CES0000000001", bls: "CES0000000001", label: "Nonfarm payrolls, monthly change", transform: "diff", unit: "thousands" },
  { id: "CES0500000001", bls: "CES0500000001", label: "Private payrolls, monthly change", transform: "diff", unit: "thousands" },
  { id: "LNS14000000", bls: "LNS14000000", label: "Unemployment rate", transform: "level", unit: "percent" },
  { id: "CES0500000003", bls: "CES0500000003", label: "Average hourly earnings, y/y", transform: "yoy", unit: "percent" },
  { id: "CES0500000003:mom", bls: "CES0500000003", label: "Average hourly earnings, m/m", transform: "mom", unit: "percent" },
  { id: "JTS000000000000000JOL", bls: "JTS000000000000000JOL", label: "JOLTS job openings", transform: "level", unit: "thousands" },
] as const;

/**
 * The series published by others: the Bureau of Economic Analysis (PCE
 * prices, GDP, personal income and spending), read from DBnomics' mirror of
 * its tables (the BEA's own API wants a key), and the University of
 * Michigan's consumer sentiment, from its own file.
 */
export const OTHER_SERIES = [
  { id: "BEA:DPCERG-M", source: "bea", path: "BEA/NIPA-T20804/DPCERG-M", label: "PCE prices, y/y", transform: "yoy", unit: "percent" },
  { id: "BEA:DPCERG-M:mom", source: "bea", path: "BEA/NIPA-T20804/DPCERG-M", label: "PCE prices, m/m", transform: "mom", unit: "percent" },
  { id: "BEA:DPCCRG-M", source: "bea", path: "BEA/NIPA-T20804/DPCCRG-M", label: "Core PCE prices, y/y", transform: "yoy", unit: "percent" },
  { id: "BEA:DPCCRG-M:mom", source: "bea", path: "BEA/NIPA-T20804/DPCCRG-M", label: "Core PCE prices, m/m", transform: "mom", unit: "percent" },
  { id: "BEA:A191RL-Q", source: "bea", path: "BEA/NIPA-T10101/A191RL-Q", label: "Real GDP, quarter on quarter annualised", transform: "level", unit: "percent" },
  { id: "BEA:A065RC-M:mom", source: "bea", path: "BEA/NIPA-T20600/A065RC-M", label: "Personal income, m/m", transform: "mom", unit: "percent" },
  { id: "BEA:DPCERC-M:mom", source: "bea", path: "BEA/NIPA-T20600/DPCERC-M", label: "Personal spending, m/m", transform: "mom", unit: "percent" },
  { id: "UMICH:ICS", source: "umich", path: "https://www.sca.isr.umich.edu/files/tbmics.csv", label: "Michigan consumer sentiment", transform: "level", unit: "index" },
] as const;

/** Every series a history can be opened on, by id. */
export const ALL_SERIES: ReadonlyArray<{ id: string; label: string; transform: string; unit: string; bls?: string; path?: string; source?: string }> = [...BLS_SERIES, ...OTHER_SERIES];

export interface EconSeries { id: string; label: string; unit: "percent" | "thousands" | "index"; points: Array<{ period: string; value: number }>; latest: string | null }

/** The official series a calendar event is the headline of, where there is one. */
export function seriesForEvent(name: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/^CPI, y\/y$/i, "CUUR0000SA0"], [/^CPI, m\/m$/i, "CUSR0000SA0"],
    [/^Core CPI, y\/y$/i, "CUUR0000SA0L1E"], [/^Core CPI, m\/m$/i, "CUSR0000SA0L1E"],
    [/^PPI, y\/y$/i, "WPUFD4"], [/^PPI, m\/m$/i, "WPSFD4"],
    [/^Core PPI, y\/y$/i, "WPUFD49104"], [/^Core PPI, m\/m$/i, "WPSFD49104"],
    [/^Nonfarm Payrolls$/i, "CES0000000001"], [/^Private Nonfarm Payrolls$/i, "CES0500000001"],
    [/^Unemployment Rate$/i, "LNS14000000"],
    [/^Average Hourly Earnings \(YoY\)$|^Average Hourly Earnings, y\/y$/i, "CES0500000003"],
    [/^Average Hourly Earnings(?:, m\/m| \(MoM\))?$/i, "CES0500000003:mom"],
    [/^JOLTS Job Openings$/i, "JTS000000000000000JOL"],
    [/^PCE Price Index, y\/y$/i, "BEA:DPCERG-M"], [/^PCE Price Index, m\/m$/i, "BEA:DPCERG-M:mom"],
    [/^Core PCE Price Index, y\/y$/i, "BEA:DPCCRG-M"], [/^Core PCE Price Index, m\/m$/i, "BEA:DPCCRG-M:mom"],
    [/^GDP$/i, "BEA:A191RL-Q"],
    [/^Personal Income$/i, "BEA:A065RC-M:mom"], [/^Personal Spending$/i, "BEA:DPCERC-M:mom"],
    [/^Michigan Consumer Sentiment$/i, "UMICH:ICS"],
  ];
  return rules.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}

