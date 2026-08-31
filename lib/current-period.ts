import type { CompanyDataset, FinancialPeriod } from "./types";

/**
 * The period a company's current figures are read from.
 *
 * A trailing twelve months is the right window when it exists: four filed
 * quarters ending later than the last annual report. But it only exists where
 * the quarters can be built, and for some filers the chain stops years ago —
 * JPMorgan's last derivable trailing window ends in December 2014, because a
 * bank's quarterly revenue concepts stop lining up after that. Preferring TTM
 * unconditionally then dated the whole company page to 2014: revenue of 95bn
 * against the 182bn its 2025 annual report states, every margin from a decade
 * ago, and today's market capitalisation printed beside them — the current
 * price against a historical flow that this application exists to refuse.
 *
 * So the later of the two wins, by the date it ends. A tie goes to the trailing
 * window, which is the same year stated as a rolling one and is what every
 * screen showed before.
 */
export function currentPeriod(periods: FinancialPeriod[]): FinancialPeriod | undefined {
  const latestOf = (periodicity: FinancialPeriod["periodicity"]) =>
    periods.filter((period) => period.periodicity === periodicity)
      .sort((left, right) => left.periodEnd.localeCompare(right.periodEnd)).at(-1);
  const ttm = latestOf("ttm"); const annual = latestOf("annual");
  if (!ttm) return annual;
  if (!annual) return ttm;
  return annual.periodEnd > ttm.periodEnd ? annual : ttm;
}

export function currentDatasetPeriod(dataset: CompanyDataset): FinancialPeriod | undefined {
  return currentPeriod(dataset.periods);
}
