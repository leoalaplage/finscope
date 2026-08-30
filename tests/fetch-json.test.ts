import { describe, expect, it, vi } from "vitest";
import { getJson, readJson } from "../lib/fetch-json";

const answer = (body: string, init: ResponseInit = {}) => new Response(body, init);

describe("reading a JSON answer", () => {
  it("returns the parsed body when there is one", async () => {
    expect(await readJson<{ ok: number }>(answer('{"ok":1}'), { what: "the watchlist" })).toEqual({ ok: 1 });
  });

  it("never shows the parser's own error for a body that is not JSON", async () => {
    /*
     * The defect this exists for. Every fetch parsed before checking the
     * status, so a Cloudflare error page reached `JSON.parse` and Safari's
     * message for that — "The string did not match the expected pattern" —
     * is what a reader saw on the heat map.
     */
    await expect(readJson(answer("error code: 1102", { status: 503 }), { what: "today's moves" }))
      .rejects.toThrow(/too busy/i);
    await expect(readJson(answer("<html>Bad gateway</html>", { status: 502 }), { what: "today's moves" }))
      .rejects.toThrow(/did not answer in time/i);
    for (const bad of ["error code: 1102", "<html>Bad gateway</html>"]) {
      await expect(readJson(answer(bad, { status: 502 }), { what: "x" })).rejects.not.toThrow(/expected pattern/i);
    }
  });

  it("prefers what the server actually said went wrong", async () => {
    await expect(readJson(answer('{"error":"Ticker could not be resolved"}', { status: 502 }), { what: "the company" }))
      .rejects.toThrow("Ticker could not be resolved");
  });

  it("names what was being loaded when the server says nothing useful", async () => {
    await expect(readJson(answer("", { status: 404 }), { what: "the valuation history" }))
      .rejects.toThrow(/Could not load the valuation history \(404\)/);
  });

  it("treats a successful response that is not JSON as a failure", async () => {
    // An edge or a proxy answering in our place with a 200 and a login page.
    await expect(readJson(answer("<html>Sign in</html>"), { what: "the market session" }))
      .rejects.toThrow(/something other than data/);
  });

  it("says the connection failed rather than repeating the browser's wording", async () => {
    // "Load failed" and "NetworkError when attempting to fetch resource" are
    // the same event with two names, and neither belongs on screen.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    await expect(getJson("/api/movers", { what: "today's moves" }))
      .rejects.toThrow(/Could not reach the server for today's moves/);
    vi.unstubAllGlobals();
  });

  it("says too many requests rather than a bare 429", async () => {
    await expect(readJson(answer("", { status: 429 }), { what: "prices" })).rejects.toThrow(/Too many requests/);
  });
});
