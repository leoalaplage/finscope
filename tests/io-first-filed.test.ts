import { describe, expect, it } from "vitest";
import { dedupeFacts } from "../lib/periods";
import type { RawFinancialFact } from "../lib/types";

/**
 * Which filing a figure came from, and which one made it news.
 *
 * These are two different dates and the difference is a year. A quarter is
 * republished as a comparative in the following year's report whether or not
 * anything about it changed, so the newest filing carrying a figure — the one
 * whose value wins, because a restatement supersedes what it corrects — is
 * routinely a year after the day a reader could first have seen it.
 *
 * Everything that asks "what could someone have known, and when" needs the
 * other date. Sixty-two of Apple's sixty-nine trailing periods carried a filing
 * date about four hundred days after their close where the true lag is
 * thirty-four, and the valuation history priced every historical multiple on
 * it: a year-old set of figures against a year-newer price, which for a growing
 * company inflates every multiple in the series.
 */
const fact = (over: Partial<RawFinancialFact>): RawFinancialFact => ({
  metric: "revenue", value: 100, currency: "USD", unit: "currency",
  start: "2024-01-01", end: "2024-03-31", filed: "2024-05-01", accession: "a",
  fiscalYear: 2024, fiscalPeriod: "Q1", form: "10-Q", concept: "us-gaap:Revenues",
  sourceUrl: "https://example.test", retrievedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("a figure filed more than once", () => {
  it("takes its value from the newest filing and its date from the first", () => {
    const [only] = dedupeFacts([
      fact({ filed: "2024-05-01", accession: "original", value: 100 }),
      fact({ filed: "2025-05-01", accession: "comparative", value: 104 }),
    ]);
    // The restatement is the better number...
    expect(only.value).toBe(104);
    expect(only.filed).toBe("2025-05-01");
    // ...and it was still news in May 2024.
    expect(only.firstFiled).toBe("2024-05-01");
  });

  it("dates an unrepeated figure by its only filing", () => {
    const [only] = dedupeFacts([fact({ filed: "2024-05-01" })]);
    expect(only.firstFiled).toBe("2024-05-01");
  });

  it("ignores a filing whose magnitude was rejected", () => {
    /*
     * A fact three orders of magnitude away is a units conflict, not evidence
     * of when this figure was known. Dating the accepted value by a rejected
     * one would put a publication date on a number nobody published.
     */
    const [only] = dedupeFacts([
      fact({ filed: "2023-01-01", value: 100_000_000 }),
      fact({ filed: "2024-05-01", value: 100 }),
      fact({ filed: "2025-05-01", value: 104 }),
    ]);
    expect(only.value).toBe(100_000_000);
    expect(only.firstFiled).toBe("2023-01-01");
  });
});
