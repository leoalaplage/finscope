import { describe, expect, it } from "vitest";
import { dividendRecord } from "../lib/dividends";

const quarterly = (from: number, to: number, start: number, raise: number) => {
  const payments = [];
  let amount = start;
  for (let year = from; year <= to; year++) {
    for (const month of ["03-15", "06-15", "09-15", "12-15"]) payments.push({ date: `${year}-${month}`, amount: Number(amount.toFixed(4)) });
    amount *= 1 + raise;
  }
  return payments;
};

describe("a dividend record", () => {
  const today = new Date("2026-10-14T12:00:00Z");

  it("reads the rhythm, the rate, the growth and the years raised in a row", () => {
    const record = dividendRecord(quarterly(2011, 2026, 0.25, 0.05).filter((payment) => payment.date < "2026-10-01"), today)!;
    expect(record.frequency).toBe(4);
    expect(record.annualRate).toBeCloseTo(4 * 0.25 * 1.05 ** 15, 3);
    expect(record.growth5).toBeCloseTo(0.05, 3);
    expect(record.raisedYears).toBe(14);
    expect(record.nextExpected).toBe("2026-12-15");
  });

  it("counts a special dividend in the year's cash but not in the rate", () => {
    const payments = [...quarterly(2022, 2025, 0.5, 0), { date: "2025-12-20", amount: 3 }].sort((a, b) => a.date.localeCompare(b.date));
    const record = dividendRecord(payments, new Date("2026-01-10T12:00:00Z"))!;
    expect(record.payments.find((payment) => payment.amount === 3)?.special).toBe(true);
    expect(record.annualRate).toBeCloseTo(2);
    expect(record.years.find((entry) => entry.year === 2025)?.special).toBe(3);
    expect(record.raisedYears).toBe(0);
    expect(record.uncutYears).toBe(3);
  });

  it("gives no rate and no next date to a payer that has stopped", () => {
    const record = dividendRecord(quarterly(2015, 2019, 0.4, 0.02), today)!;
    expect(record.annualRate).toBeNull();
    expect(record.nextExpected).toBeNull();
  });
});

describe("a monthly payer", () => {
  it("compares years by their rate, not by how many ex-dates fell in them", () => {
    const payments: Array<{ date: string; amount: number }> = [];
    let amount = 0.2;
    for (let year = 2018; year <= 2025; year++) {
      // Thirteen ex-dates one year, eleven the next: the cash moves, the rate does not fall.
      const months = year === 2022 ? 13 : year === 2023 ? 11 : 12;
      for (let index = 0; index < months; index++) payments.push({ date: `${year}-${String(Math.min(12, index + 1)).padStart(2, "0")}-${index === 12 ? "28" : "01"}`, amount: Number(amount.toFixed(4)) });
      amount *= 1.03;
    }
    const record = dividendRecord(payments, new Date("2026-01-15T12:00:00Z"))!;
    expect(record.frequency).toBe(12);
    expect(record.raisedYears).toBe(7);
    expect(record.raisedSinceRecord).toBe(true);
  });
});
