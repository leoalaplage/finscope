import { describe, expect, it } from "vitest";
import { followedTickers, mergeSynced, ITEM_LIMIT, type SyncedData } from "../lib/account-sync";
import { alertEmail, emailDue } from "../lib/email-alerts";
import { EMAIL_PATTERN, sessionCookie, sessionToken, type Account } from "../lib/accounts";
import type { Alert } from "../lib/alerts";

describe("the account's copy of the reader's work", () => {
  it("keeps the newer copy of each key, and nothing it does not sync", () => {
    const held: SyncedData = { "finscope.io.thesis.v1": { value: "[1]", at: "2026-10-10T00:00:00.000Z" }, "finscope.io.portfolio.v1": { value: "[]", at: "2026-10-12T00:00:00.000Z" } };
    const merged = mergeSynced(held, {
      "finscope.io.thesis.v1": { value: "[1,2]", at: "2026-10-11T00:00:00.000Z" },
      "finscope.io.portfolio.v1": { value: "[old]", at: "2026-10-01T00:00:00.000Z" },
      ...({ "finscope.theme": { value: "dark", at: "2026-10-13T00:00:00.000Z" } } as SyncedData),
      "finscope.io.watchlists.v1": { value: "x".repeat(ITEM_LIMIT + 1), at: "2026-10-13T00:00:00.000Z" },
    });
    expect(merged["finscope.io.thesis.v1"]!.value).toBe("[1,2]");
    expect(merged["finscope.io.portfolio.v1"]!.value).toBe("[]");
    expect(Object.keys(merged)).toEqual(["finscope.io.thesis.v1", "finscope.io.portfolio.v1"]);
  });

  it("finds the tickers followed in the watchlists, the portfolio and the notes", () => {
    const data: SyncedData = {
      "finscope.io.watchlists.v1": { value: JSON.stringify({ activeId: "main", lists: [{ id: "main", tickers: ["AAPL", "msft"] }] }), at: "2026-10-10T00:00:00.000Z" },
      "finscope.io.portfolio.v1": { value: JSON.stringify([{ ticker: "VOO", shares: 3 }]), at: "2026-10-10T00:00:00.000Z" },
      "finscope.io.thesis.v1": { value: JSON.stringify([{ id: "1", ticker: "DAL", text: "<script>" }]), at: "2026-10-10T00:00:00.000Z" },
      "finscope.term.workspace.v1": { value: JSON.stringify({ ticker: "NOPE" }), at: "2026-10-10T00:00:00.000Z" },
    };
    expect(followedTickers(data)).toEqual(["AAPL", "DAL", "MSFT", "VOO"]);
  });
});

describe("sessions and addresses", () => {
  it("reads only its own cookie, and clears it", () => {
    const request = new Request("https://finscope.test/api/account", { headers: { cookie: "other=1; fs_session=abcdefghijklmnopqrstuvwxyz012345" } });
    expect(sessionToken(request)).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect(sessionToken(new Request("https://finscope.test/", { headers: { cookie: "fs_session=short" } }))).toBeNull();
    expect(sessionCookie(null, request)).toMatch(/Max-Age=0; Secure$/);
    expect(sessionCookie("t".repeat(30), request)).toMatch(/HttpOnly; SameSite=Lax/);
  });

  it("takes an email address and refuses what is not one", () => {
    expect(EMAIL_PATTERN.test("reader@example.com")).toBe(true);
    expect(EMAIL_PATTERN.test("reader@example")).toBe(false);
    expect(EMAIL_PATTERN.test("<a>@example.com")).toBe(false);
  });
});

describe("the daily email", () => {
  const account = (email: Account["email"]): Account => ({ id: "a", name: "A", created: "2026-01-01", credentials: [], email });
  const alert = (ticker: string, title: string): Alert => ({ ticker, kind: "results", at: "2026-10-14T20:05:00.000Z", title, detail: null, url: "https://www.sec.gov/x" });

  it("goes after the US close, once a day, only to a confirmed address that asked for it", () => {
    const evening = new Date("2026-10-14T21:30:00Z");
    expect(emailDue(account({ address: "a@b.co", verified: true, alerts: true, lastSent: null }), evening)).toBe(true);
    expect(emailDue(account({ address: "a@b.co", verified: true, alerts: true, lastSent: "2026-10-14T21:00:00Z" }), evening)).toBe(false);
    expect(emailDue(account({ address: "a@b.co", verified: false, alerts: true, lastSent: null }), evening)).toBe(false);
    expect(emailDue(account({ address: "a@b.co", verified: true, alerts: false, lastSent: null }), evening)).toBe(false);
    expect(emailDue(account({ address: "a@b.co", verified: true, alerts: true, lastSent: null }), new Date("2026-10-14T15:00:00Z"))).toBe(false);
  });

  it("is never sent empty, and escapes what the filings say", () => {
    expect(alertEmail("a@b.co", [], "https://finscope.test", "2026-10-13")).toBeNull();
    const email = alertEmail("a@b.co", [alert("DAL", "Results <b>Q3</b>"), alert("UAL", "8-K")], "https://finscope.test", "2026-10-13")!;
    expect(email.subject).toBe("FinScope · 2 alerts on DAL, UAL");
    expect(email.html).toContain("Results &lt;b&gt;Q3&lt;/b&gt;");
    expect(email.text).toContain("https://finscope.test/t/account");
  });
});

describe("what the account page says each store holds", () => {
  it("counts lists, tickers, notes and saved screens", async () => {
    const { describeSynced } = await import("../lib/account-sync");
    expect(describeSynced("finscope.io.watchlists.v1", JSON.stringify({ lists: [{ tickers: ["AAPL", "MSFT"] }, { tickers: ["AAPL", "DAL"] }] }))).toBe("2 lists · 3 tickers");
    expect(describeSynced("finscope.io.thesis.v1", JSON.stringify([{}]))).toBe("1 note");
    expect(describeSynced("finscope.free-screener.v1", JSON.stringify({ saved: [{}, {}] }))).toBe("2 saved screens");
    expect(describeSynced("finscope.io.alerts-seen.v1", "2026-10-14T21:00:00.000Z")).toBe("Up to 2026-10-14");
    expect(describeSynced("finscope.term.workspace.v1", "{}")).toBeNull();
    expect(describeSynced("finscope.io.thesis.v1", null)).toBeNull();
  });
});
