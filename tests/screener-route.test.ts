import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/universe-build", () => ({ readServedUniverse: vi.fn() }));
vi.mock("@/lib/term/tech-universe", () => ({ readTechTable: vi.fn() }));
vi.mock("@/lib/runtime-env", () => ({ datasetCache: vi.fn() }));
import { readServedUniverse } from "@/lib/universe-build";
import { readTechTable } from "@/lib/term/tech-universe";
import { datasetCache } from "@/lib/runtime-env";
import { GET } from "@/app/api/screener/route";
import type { ScreenerFeed } from "@/lib/screener-feed";

describe("the unified screener endpoint", () => {
  beforeEach(() => { vi.mocked(readServedUniverse).mockResolvedValue(null); vi.mocked(readTechTable).mockResolvedValue(null); vi.mocked(datasetCache).mockReturnValue(null); });
  it("returns an explicit building response when no financial snapshot exists", async () => {
    const response = await GET(new Request("https://finscope.test/api/screener"));
    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as ScreenerFeed;
    expect(body.coverage.fundamental).toBe(0);
    expect(body.rows).toHaveLength(503);
  });
  it("reads the aggregate consensus key once, without per-company or external requests", async () => {
    const get = vi.fn().mockResolvedValue(null);
    vi.mocked(datasetCache).mockReturnValue({ get } as never);
    const response = await GET(new Request("https://finscope.test/api/screener"));
    expect(response.status).toBe(202);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("screener-consensus:v1", "json");
  });
  it("survives an unavailable consensus cache", async () => {
    vi.mocked(datasetCache).mockReturnValue({ get: vi.fn().mockRejectedValue(new Error("KV unavailable")) } as never);
    expect((await GET(new Request("https://finscope.test/api/screener"))).status).toBe(202);
  });
});
