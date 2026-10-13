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
  const chosen = !ttm ? annual : !annual ? ttm : annual.periodEnd > ttm.periodEnd ? annual : ttm;
  /*
   * Not a year that the company's own later quarters have left behind.
   * Paramount Skydance's quarters since its merger cannot make a trailing year
   * yet, and the newest one there is ends in June 2025 — its predecessor's,
   * before the merger. Read as current, it priced today's company on a
   * business that no longer exists. A year ending more than 300 days before
   * the newest quarter is history; the third quarter after a year end is 274.
   */
  return chosen && leftBehind(periods, chosen) ? undefined : chosen;
}

/** Whether the company's own quarters have run more than 300 days past this period's end. */
export function leftBehind(periods: FinancialPeriod[], period: FinancialPeriod): boolean {
  const quarter = periods.filter((each) => each.periodicity === "quarterly").reduce<string | null>((latest, each) => (latest == null || each.periodEnd > latest ? each.periodEnd : latest), null);
  return quarter != null && Date.parse(quarter) - Date.parse(period.periodEnd) > 300 * 86_400_000;
}

export function currentDatasetPeriod(dataset: CompanyDataset): FinancialPeriod | undefined {
  return currentPeriod(dataset.periods);
}
