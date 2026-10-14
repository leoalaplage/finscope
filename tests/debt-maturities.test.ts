import { describe, expect, it } from "vitest";
import { scheduleFromConcepts, scheduleFromNotes } from "../lib/debt-maturities";

describe("when the debt falls due", () => {
  it("reads the tagged schedule at the latest annual date, and refuses a stale one", () => {
    const fact = (end: string, val: number) => [{ end, val, form: "10-K", filed: "2026-02-20" }];
    const facts = {
      LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths: [...fact("2024-12-31", 9), ...fact("2025-12-31", 1)],
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo: fact("2025-12-31", 2),
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree: fact("2025-12-31", 3),
      LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive: fact("2025-12-31", 10),
    };
    const schedule = scheduleFromConcepts(facts, new Date("2026-10-14"))!;
    expect(schedule.asOf).toBe("2025-12-31");
    expect(schedule.buckets.map((bucket) => bucket.value)).toEqual([1, 2, 3, 0, 0, 10]);
    expect(schedule.buckets[0].label).toBe("FY26");
    expect(scheduleFromConcepts(facts, new Date("2028-06-01"))).toBeNull();
  });

  it("adds a 10-K's notes up by the year they mature, from a date, a term or a name", () => {
    const context = (id: string, member: string) => `<context id="${id}"><entity><segment><xbrldi:explicitMember dimension="us-gaap:LongtermDebtTypeAxis">x:${member}</xbrldi:explicitMember></segment></entity><period><instant>2026-01-25</instant></period></context>`;
    const xml = `<dei:DocumentPeriodEndDate contextRef="d">2026-01-25</dei:DocumentPeriodEndDate>
      ${context("a", "A2026NotesMember")}${context("b", "NotesDue2031Member")}${context("c", "TermLoanMember")}
      <us-gaap:DebtInstrumentCarryingAmount contextRef="a">1000</us-gaap:DebtInstrumentCarryingAmount>
      <us-gaap:DebtInstrumentTerm contextRef="a">P0Y7M6D</us-gaap:DebtInstrumentTerm>
      <us-gaap:DebtInstrumentFaceAmount contextRef="b">2000</us-gaap:DebtInstrumentFaceAmount>
      <us-gaap:DebtInstrumentFaceAmount contextRef="c">500</us-gaap:DebtInstrumentFaceAmount>
      <us-gaap:DebtInstrumentMaturityDate contextRef="c">2028-03-01</us-gaap:DebtInstrumentMaturityDate>`;
    const schedule = scheduleFromNotes(xml, { form: "10-K", filed: "2026-02-25", url: "u" })!;
    expect(schedule.source).toBe("notes");
    expect(schedule.total).toBe(3500);
    expect(schedule.notes!.map((note) => note.maturity)).toEqual(["2026-08-31", "2028-03-01", "2031-06-30"]);
    expect(schedule.buckets.map((bucket) => bucket.value)).toEqual([1000, 0, 500, 0, 0, 2000]);
  });
});
