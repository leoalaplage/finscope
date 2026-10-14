import { describe, expect, it } from "vitest";
import { filingAlerts, insiderAlerts, sortAlerts } from "../lib/alerts";
import type { FilingEvent } from "../lib/adapters/filing-events";

const event = (date: string, form: string, codes: Array<[string, string, boolean]>): FilingEvent => ({
  date, accepted: `${date}T12:00:00.000Z`, form, accession: date, url: `u-${date}`, document: null,
  items: codes.map(([code, label, flag]) => ({ code, label, category: "other", flag })), category: "other", flag: codes.some(([, , flag]) => flag),
});

describe("alerts on the companies a reader follows", () => {
  it("keeps results, reports, leadership, deals and flags since the date, and nothing else", () => {
    const alerts = filingAlerts("AAA", [
      event("2026-10-10", "8-K", [["2.02", "Results of operations", false]]),
      event("2026-10-09", "10-Q", [["10-Q", "Quarterly report", false]]),
      event("2026-10-08", "8-K", [["4.02", "Past statements no longer reliable", true]]),
      event("2026-10-07", "8-K", [["7.01", "Regulation FD disclosure", false]]),
      event("2026-10-06", "8-K", [["5.02", "Director or officer change", false]]),
      event("2026-09-01", "8-K", [["2.02", "Results of operations", false]]),
    ], "2026-10-01");
    expect(alerts.map((alert) => alert.kind)).toEqual(["results", "report", "flag", "leadership"]);
  });

  it("adds the insiders' purchases of the companies followed, newest first", () => {
    const purchase = { ticker: "AAA", cik: "1", owner: "Jane Doe", role: "Director", date: "2026-10-09", filed: "2026-10-11", shares: 100, price: 50, value: 5000, sharesAfter: null, url: "p" };
    const alerts = sortAlerts([...insiderAlerts([purchase, { ...purchase, ticker: "ZZZ" }], new Set(["AAA"]), "2026-10-01"), ...filingAlerts("AAA", [event("2026-10-10", "8-K", [["2.02", "Results of operations", false]])], "2026-10-01")]);
    expect(alerts.map((alert) => alert.kind)).toEqual(["insider", "results"]);
    expect(alerts[0].title).toBe("Jane Doe bought");
  });
});
