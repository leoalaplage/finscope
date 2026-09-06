const OECD_COUNTRIES = new Set(["USA", "GBR", "JPN", "CHN", "CAN"]);
const OECD_DATAFLOWS = [
  "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
  "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
];

async function readOfficial(url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: "text/csv", "User-Agent": "FinScope/1.0 macro source" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.text();
    const status = response.status;
    const retryable = status === 429 || status >= 500;
    await response.body?.cancel();
    if (!retryable || attempt === 2) throw new Error(`OECD returned ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error("OECD is temporarily unavailable.");
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const country = url.searchParams.get("country")?.toUpperCase() ?? "";
    if (url.pathname !== "/oecd/cpi" || !OECD_COUNTRIES.has(country)) {
      return Response.json({ error: "Unknown macro source request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const cacheKey = new Request(`https://finscope.internal/oecd/cpi?country=${country}`);
    const edgeCache = (caches as CacheStorage & { default: Cache }).default;
    const cached = await edgeCache.match(cacheKey);
    if (cached) return cached;

    let lastError = "OECD is temporarily unavailable.";
    for (const dataflow of OECD_DATAFLOWS) {
      const key = `${country}.M.N.CPI.IX._T.N._Z`;
      const source = `https://sdmx.oecd.org/public/rest/data/${dataflow}/${key}?startPeriod=1990-01&dimensionAtObservation=AllDimensions&format=csvfile`;
      try {
        const csv = await readOfficial(source);
        if (!csv.includes("TIME_PERIOD") || !csv.includes("OBS_VALUE")) continue;
        const response = new Response(csv, {
          headers: {
            "Cache-Control": "public, max-age=21600, stale-while-revalidate=2592000",
            "Content-Type": "text/csv; charset=utf-8",
            "X-FinScope-Source": "OECD",
          },
        });
        ctx.waitUntil(edgeCache.put(cacheKey, response.clone()));
        return response;
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : lastError;
      }
    }
    return Response.json({ error: lastError }, { status: 502, headers: { "Cache-Control": "no-store" } });
  },
};
