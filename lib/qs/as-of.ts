import type { CompanyDataset, FinancialPeriod } from "../types";

/**
 * The company as it was known on a past day, and nothing that came later.
 *
 * The score this application shows is struck on everything filed to date, and
 * that is the right answer to "what is this business". It is the wrong answer
 * to "would this score have told me anything", because the figures it reads
 * were not public when the decision would have been made: a 2019 score built
 * from a 2021 annual report is a score with tomorrow's newspaper in it, and
 * every such test produces a wonderful result that means nothing.
 *
 * So a measurement has to be able to ask the dataset what it looked like on a
 * given morning. That is entirely a question of when each period became public
 * — `publishedAt`, the day the figures were first reported, falling back to the
 * filing they were read out of — and it is a question the dataset can already
 * answer for every period it holds, which is why this file is fifteen lines
 * rather than a second pipeline.
 *
 * Nothing here is used by a page. It exists so that a claim about the score
 * can be checked rather than asserted.
 */

/** The day a period became public: when it was first reported, else when it was filed. */
export function publishedOn(period: FinancialPeriod): string {
  return (period.publishedAt ?? period.filingDate ?? "").slice(0, 10);
}

/**
 * The same dataset with every period published after `date` removed.
 *
 * A period with no publication date at all is dropped rather than kept: an
 * undated figure cannot be shown to have been public, and a measurement that
 * keeps what it cannot date is a measurement that quietly keeps the future.
 */
export function datasetAsOf(dataset: CompanyDataset, date: string): CompanyDataset {
  const cutoff = date.slice(0, 10);
  return {
    ...dataset,
    periods: dataset.periods.filter((period) => {
      const published = publishedOn(period);
      return published !== "" && published <= cutoff;
    }),
    // The dataset says when it was read; as of that morning it had been read
    // then, whatever today's copy says.
    retrievedAt: `${cutoff}T00:00:00.000Z`,
  };
}

/** Whether a dataset holds enough history on that day to be worth scoring. */
export function hasHistoryOn(dataset: CompanyDataset, date: string, years = 6): boolean {
  const annual = datasetAsOf(dataset, date).periods.filter((period) => period.periodicity === "annual");
  return annual.length >= years;
}
