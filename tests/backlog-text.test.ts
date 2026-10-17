import { describe, expect, it } from "vitest";
import { backlogFromText } from "@/lib/adapters/backlog";

describe("backlog stated in a filing's text", () => {
  const amazon = `<p>Additionally, we have performance obligations, primarily related to AWS, associated with commitments in customer
    contracts for future services. For contracts with original terms that exceed one year, those commitments not yet recognized were
    approximately $&#160;496 billion as of June 30, 2026. The weighted-average remaining life of our long-term contracts is 6.4 years.</p>`;

  it("reads the figure at the filing's own date", () => {
    expect(backlogFromText(amazon, "2026-06-30")).toBe(496e9);
  });

  it("takes no figure for another date, and none away from performance obligations", () => {
    expect(backlogFromText(amazon, "2026-03-31")).toBeNull();
    expect(backlogFromText("<p>Unearned revenue was $25.0 billion as of June 30, 2026.</p>", "2026-06-30")).toBeNull();
  });
});
