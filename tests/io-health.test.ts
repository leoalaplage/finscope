import { describe, expect, it } from "vitest";
import { borrowingsAbsent, companyHealth, type HealthPeriod } from "../lib/io/health";

/**
 * The readings below are the filed figures, rounded, from the trailing windows
 * these companies had filed on 9 September 2026. They are here because the
 * cases this panel exists for are all real ones: a company with negative book
 * equity and no debt problem, a retailer that fails a current ratio every year
 * of its life, a company burning cash with a decade of it, and one burning cash
 * with sixteen months.
 */

const bn = (value: number) => value * 1e9;
const period = (label: string, values: Record<string, number | null>): HealthPeriod =>
  ({ label, end: "2026-06-30", currency: "USD", values });

/** Enough parsed balance sheets for the debt-free test to have something to read. */
const history = (values: Record<string, number | null>) =>
  ["FY 2023", "FY 2024", "FY 2025"].map((label) => period(label, values));

describe("what a health verdict is struck on", () => {
  it("reads Booking as sound and never divides by its negative equity", () => {
    /*
     * Booking's book equity is minus eleven billion because it has bought back
     * more stock than it has retained; its borrowings are a third of one year's
     * free cash flow. Every panel that divides debt by equity reports it as
     * more leveraged than a company in default.
     */
    const bkng = period("TTM Q2 FY2026", {
      totalDebt: bn(20.18), cashAndEquivalents: bn(17.21), shortTermInvestments: null,
      ebitda: bn(9.86), freeCashFlow: bn(9.54), operatingIncome: bn(9.28), interestExpense: bn(1.10),
      longTermDebtCurrent: bn(2.00), shortTermBorrowings: null, dividendsPaid: bn(1.28),
      totalEquity: bn(-10.78), retainedEarnings: bn(43.05), totalAssets: bn(29.68),
    });
    const reading = companyHealth(bkng, [bkng], "operating")!;
    expect(reading.state).toBe("sound");
    // A reading in words where a number would be an artefact.
    expect(reading.questions.find((question) => question.key === "burden")!.reading).toBe("0.3 years");
    /*
     * Nothing on the panel is struck on equity, and nothing on it mentions
     * equity: a page that has to explain why a ratio is absent is a page still
     * thinking about the ratio. The verdict rests on profit and cash.
     */
    expect(reading.questions.some((question) => question.basis.includes("equity"))).toBe(false);
    expect(reading.notes.some((note) => /equity|retained|buyback/i.test(note.text))).toBe(false);
  });

  it("grades a company with an accumulated deficit on its cash flow alone", () => {
    const abbv = period("TTM Q2 FY2026", {
      totalDebt: bn(62.48), cashAndEquivalents: bn(6.57), shortTermInvestments: null,
      ebitda: bn(17.65), freeCashFlow: bn(18.21), operatingIncome: bn(16.87), interestExpense: bn(2.92),
      longTermDebtCurrent: null, shortTermBorrowings: 0, dividendsPaid: bn(11.98),
      totalEquity: bn(-5.93), retainedEarnings: bn(-17.33), totalAssets: bn(135.12),
    });
    const reading = companyHealth(abbv, [abbv], "operating")!;
    expect(reading.notes.some((note) => /equity|deficit/i.test(note.text))).toBe(false);
    expect(reading.state).toBe("stretched");
  });

  it("does not fail a retailer for selling its stock before it pays for it", () => {
    /*
     * Walmart's current ratio is 0.77 and has been for its whole listed life.
     * The question here is cash plus a year's generation against what falls
     * due, which it passes — because the float is the business model, not a
     * liquidity problem.
     */
    const wmt = period("TTM Q2 FY2027", {
      totalDebt: bn(39.93), cashAndEquivalents: bn(11.53), shortTermInvestments: null,
      ebitda: bn(47.37), freeCashFlow: bn(13.51), operatingIncome: bn(32.28), interestExpense: bn(1.86),
      longTermDebtCurrent: bn(3.47), shortTermBorrowings: bn(10.48), dividendsPaid: bn(7.70),
      currentAssets: bn(88.70), currentLiabilities: bn(115.63), totalEquity: bn(98.24), totalAssets: bn(293.91),
    });
    const reading = companyHealth(wmt, [wmt], "operating")!;
    const nearTerm = reading.questions.find((question) => question.key === "nearTerm")!;
    expect(nearTerm.state).toBe("adequate");
    expect(reading.state).toBe("adequate");
  });

  it("separates a decade of runway from sixteen months of it", () => {
    const burning = (cash: number, freeCashFlow: number) => period("TTM", {
      totalDebt: bn(1), cashAndEquivalents: bn(cash), shortTermInvestments: null,
      ebitda: bn(50), freeCashFlow: bn(freeCashFlow), operatingIncome: bn(40), interestExpense: bn(1),
      longTermDebtCurrent: bn(1), dividendsPaid: bn(1), totalEquity: bn(100), totalAssets: bn(200),
    });
    const amazonish = companyHealth(burning(123, -11.63), [], "operating")!;
    const oracleish = companyHealth(burning(31.29, -23.69), [], "operating")!;
    expect(amazonish.questions.find((question) => question.key === "runway")!.state).toBe("sound");
    expect(oracleish.questions.find((question) => question.key === "runway")!.state).toBe("strained");
    // Sixteen months is 1.3 years, not "1.3 year".
    expect(oracleish.questions.find((question) => question.key === "runway")!.reading).toBe("1.3 years");
    // The question exists only for a company that is spending its cash.
    const earning = companyHealth(burning(50, 10), [], "operating")!;
    expect(earning.questions.some((question) => question.key === "runway")).toBe(false);
  });

  it("takes the worst answer, never the average", () => {
    // Fortress liquidity and no interest cover at all: Intel, in one line.
    const intc = period("TTM Q2 FY2026", {
      totalDebt: bn(50.54), cashAndEquivalents: bn(12.87), shortTermInvestments: null,
      ebitda: bn(11.36), freeCashFlow: bn(2.83), operatingIncome: bn(-0.077), interestExpense: bn(1.15),
      longTermDebtCurrent: bn(1.99), dividendsPaid: null, totalEquity: bn(87.54), totalAssets: bn(202.44),
    });
    const reading = companyHealth(intc, [intc], "operating")!;
    expect(reading.questions.find((question) => question.key === "nearTerm")!.state).toBe("fortress");
    const cover = reading.questions.find((question) => question.key === "cover")!;
    expect(cover.state).toBe("strained");
    // Not "−0.1×", which is a multiple of a thing that does not exist.
    expect(cover.reading).toBe("Operating loss");
    expect(reading.state).toBe("strained");
  });

  it("counts the short-term investments a solvency question can be paid with", () => {
    /*
     * Alphabet holds fifty-six billion in cash and a hundred and eighty-seven
     * billion in short-term investments against a hundred billion of
     * borrowings. The site's `netDebt` subtracts only the first, because an
     * enterprise value acquires marketable securities rather than spending
     * them — the right basis for a multiple and the wrong one for this.
     */
    const googl = period("TTM Q2 FY2026", {
      totalDebt: bn(100.16), cashAndEquivalents: bn(55.91), shortTermInvestments: bn(186.56),
      netDebt: bn(44.25), ebitda: bn(172.87), freeCashFlow: bn(53.27),
      operatingIncome: bn(147.63), interestExpense: bn(2.25),
      longTermDebtCurrent: bn(2.00), dividendsPaid: null, totalEquity: bn(640.48), totalAssets: bn(921.98),
    });
    const reading = companyHealth(googl, [googl], "operating")!;
    expect(reading.questions.find((question) => question.key === "burden")!.state).toBe("fortress");
    expect(reading.notes.some((item) => item.key === "netCash")).toBe(true);
  });

  it("withholds the whole reading where the balance sheet is the business", () => {
    const jpm = period("TTM", { totalDebt: bn(532.95), cashAndEquivalents: bn(309.81), totalAssets: bn(5015) });
    expect(companyHealth(jpm, [jpm], "bank")).toBeNull();
    expect(companyHealth(jpm, [jpm], "broker")).toBeNull();
    expect(companyHealth(jpm, [jpm], "insurer")).toBeNull();
    // An exchange is not one of them: its capital expenditure is equipment.
    expect(companyHealth(jpm, [jpm], "exchange")).not.toBeNull();
  });

  it("gives no verdict rather than one struck on a single reading", () => {
    const thin = period("TTM", { freeCashFlow: bn(24.21), cashAndEquivalents: bn(41.36), totalAssets: bn(1263) });
    const reading = companyHealth(thin, [thin], "holding")!;
    expect(reading.state).toBeNull();
    expect(reading.reason).toContain("could be answered");
  });
});

describe("a reading that is not a number", () => {
  it("says None rather than dividing nothing by something", () => {
    const debtFree = period("TTM", {
      totalAssets: bn(8.9), operatingIncome: bn(2.63), freeCashFlow: bn(3.36),
      cashAndEquivalents: bn(2.03), shortTermInvestments: bn(7.38), totalEquity: bn(9.77),
    });
    const reading = companyHealth(debtFree, history({ totalAssets: bn(8.9), operatingIncome: bn(2.63) }), "operating")!;
    expect(reading.questions.find((question) => question.key === "burden")!.reading).toBe("None");
    expect(reading.questions.find((question) => question.key === "cover")!.reading).toBe("No interest");
    expect(reading.state).toBe("fortress");
  });

  it("says Net cash where cash exceeds every borrowing", () => {
    const netCash = period("TTM", {
      totalDebt: bn(5.72), cashAndEquivalents: bn(25.0), shortTermInvestments: null,
      ebitda: bn(68.25), freeCashFlow: bn(26.17), operatingIncome: bn(59.24), interestExpense: bn(0.23),
      longTermDebtCurrent: bn(0.582), dividendsPaid: bn(0.567), totalEquity: bn(100.72), totalAssets: bn(134.11),
    });
    const reading = companyHealth(netCash, [netCash], "operating")!;
    expect(reading.questions.find((question) => question.key === "burden")!.reading).toBe("Net cash");
    expect(reading.notes.some((note) => note.key === "netCash")).toBe(true);
  });
});

describe("whether an absent borrowing is a borrowing of nought", () => {
  it("needs three parsed balance sheets before it will say so", () => {
    const clean = { totalAssets: bn(8.9), operatingIncome: bn(2.63) };
    expect(borrowingsAbsent(history(clean))).toBe(true);
    expect(borrowingsAbsent(history(clean).slice(0, 2))).toBe(false);
    // No balance sheet parsed is not evidence of anything.
    expect(borrowingsAbsent(history({ operatingIncome: bn(2.63) }))).toBe(false);
  });

  it("ignores an immaterial borrowing and refuses a real one", () => {
    // Qualys tags $178k of debt against a billion of assets: a finance lease,
    // not a capital structure.
    expect(borrowingsAbsent(history({ totalAssets: bn(1.09), operatingIncome: bn(0.24), totalDebt: 178_000 }))).toBe(true);
    expect(borrowingsAbsent(history({ totalAssets: bn(1.09), operatingIncome: bn(0.24), totalDebt: bn(0.5) }))).toBe(false);
    expect(borrowingsAbsent(history({ totalAssets: bn(1.09), operatingIncome: bn(0.24), interestExpense: bn(0.1) }))).toBe(false);
  });
});
