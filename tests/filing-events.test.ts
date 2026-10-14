import { describe, expect, it } from "vitest";
import { filingEvents, itemExcerpts } from "../lib/adapters/filing-events";

describe("a company's events from its SEC index", () => {
  const recent = {
    form: ["4", "8-K", "8-K", "10-Q", "424B2", "SC 13D", "8-K", "8-K"],
    filingDate: ["2026-10-10", "2026-10-09", "2026-09-01", "2026-08-01", "2026-07-15", "2026-06-01", "2026-05-01", "2023-01-01"],
    accessionNumber: ["0000000001-26-000001", "0000000001-26-000002", "0000000001-26-000003", "0000000001-26-000004", "0000000001-26-000005", "0000000001-26-000006", "0000000001-26-000007", "0000000001-23-000008"],
    items: ["", "5.02", "2.02,9.01", "", "", "", "4.02,8.01,9.01", "1.01"],
    primaryDocument: ["f4.xml", "d8k.htm", "r8k.htm", "q.htm", "p.htm", "s.htm", "x8k.htm", "old.htm"],
  };
  const events = filingEvents(recent, "320193", "2024-10-14");

  it("names each 8-K by its items, leaves Form 4 and prospectus notes to their own panels, and stops two years back", () => {
    expect(events.map((event) => event.form)).toEqual(["8-K", "8-K", "10-Q", "SC 13D", "8-K"]);
    expect(events[0].items).toEqual([{ code: "5.02", label: "Director or officer change", category: "leadership", flag: false }]);
    expect(events[1].items.map((item) => item.code)).toEqual(["2.02"]);
    expect(events[0].url).toBe("https://www.sec.gov/Archives/edgar/data/320193/000000000126000002/0000000001-26-000002-index.htm");
  });

  it("flags what a holder must read: statements no longer reliable, an activist stake", () => {
    expect(events.find((event) => event.items.some((item) => item.code === "4.02"))?.flag).toBe(true);
    expect(events.find((event) => event.form === "SC 13D")?.flag).toBe(true);
    expect(events[0].flag).toBe(false);
  });

  it("reads the opening of an item from the filing's lines", () => {
    const lines = [
      "UNITED STATES SECURITIES AND EXCHANGE COMMISSION",
      "Item 5.02 Departure of Directors or Certain Officers; Election of Directors",
      "On October 8, 2026, Jane Doe notified the Board of Directors of her decision to retire as Chief Financial Officer, effective December 31, 2026.",
      "Item 9.01 Financial Statements and Exhibits.",
    ];
    expect(itemExcerpts(lines, ["5.02"])).toEqual([{ code: "5.02", text: lines[2] }]);
  });
});

describe("an item's text without its title", () => {
  it("starts at the first sentence after the official title", () => {
    const lines = [
      "Item 5.02",
      "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain On April 20, 2026, Apple Inc. (\"Apple\") announced that Tim Cook will transition from his role as Chief Executive Officer.",
    ];
    expect(itemExcerpts(lines, ["5.02"])[0].text).toMatch(/^On April 20, 2026, Apple Inc\./);
    const dotted = ["Item 5.02 Departure of Directors or Certain Officers .", "Departure of Directors or Certain Officers . Apple Inc. previously announced its Chief Executive Officer transition plan in a Current Report filed on April 20, 2026."];
    expect(itemExcerpts(dotted, ["5.02"])[0].text).toMatch(/^Apple Inc\. previously announced/);
  });
});
