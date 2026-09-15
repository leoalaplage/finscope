import { withheldMeasures, type IoCompanyView } from "./view";

/**
 * Why a figure is not on the page.
 *
 * A dash reads as a broken page. Three different things put one there, and a
 * reader should be able to tell them apart: this site withholds the measure
 * for this kind of company on purpose; the company has never reported it in
 * any filing read; or it reported it for other periods and not this one. The
 * sentence goes on the dash — as a tooltip in a table, as a note under a strip
 * — rather than in a help page nobody opens.
 */

export type AbsenceKind = "withheld" | "never-filed" | "not-this-period";

export interface Absence { kind: AbsenceKind; text: string }

export function absenceOf(view: IoCompanyView, key: string, label = "This figure"): Absence {
  if (withheldMeasures(view.company.businessType).has(key)) {
    return { kind: "withheld", text: view.withheldReason ?? `${label} is not stated for this kind of company.` };
  }
  const everywhere = [...view.annual, ...view.quarterly, ...view.trailing];
  if (everywhere.every((period) => period.values[key] == null)) {
    return { kind: "never-filed", text: `${label} is not in any filing read for this company: it does not report it in the SEC's standard terms.` };
  }
  return { kind: "not-this-period", text: `${label} is not reported for this period, though it is for others.` };
}
