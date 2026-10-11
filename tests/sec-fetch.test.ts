import { afterEach, describe, expect, it, vi } from "vitest";
import { secFetch } from "@/lib/adapters/sec-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("requests to the SEC", () => {
  it("try again after a refusal and return the answer that comes", async () => {
    const answers = [new Response("", { status: 403 }), new Response("ok", { status: 200 })];
    const fetch = vi.fn(async () => answers.shift()!);
    vi.stubGlobal("fetch", fetch);
    const response = await secFetch("https://data.sec.gov/x", {}, [0, 0]);
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("give up after the last try, and never retry a 404", async () => {
    const refused = vi.fn(async () => new Response("", { status: 403 }));
    vi.stubGlobal("fetch", refused);
    expect((await secFetch("https://data.sec.gov/x", {}, [0, 0])).status).toBe(403);
    expect(refused).toHaveBeenCalledTimes(3);
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", missing);
    expect((await secFetch("https://data.sec.gov/x", {}, [0, 0])).status).toBe(404);
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
