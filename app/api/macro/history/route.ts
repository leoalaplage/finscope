import {
  CPI_INDEX_SERIES,
  ECB_RATE_SERIES,
  EUROSTAT_SERIES,
  MACRO_COUNTRIES,
  OECD_SERIES,
  US_RATE_SERIES,
  eurostatUrls,
  macroDefinitionsFor,
  parseBlsObservations,
  parseEurostatObservations,
  parseSdmxCsvObservations,
  parseTreasuryHistory,
  parseWorldBankObservations,
  rebaseObservations,
  yearOverYearObservations,
  type MacroCountry,
  type MacroHistory,
  type MacroObservation,
  type MacroSeriesDefinition,
  type TreasurySeriesId,
} from "@/lib/macro";
import { marketKey } from "@/lib/market-cache";
import { datasetCache } from "@/lib/runtime-env";

type HistoryRange = "1Y" | "5Y" | "10Y" | "MAX";

const responseHeaders = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Accept-Encoding",
};

const MACRO_SOURCE_URL = "https://finscope-macro-source.leoalaplage.workers.dev";
const IMF_AREA: Record<string, string> = { US: "US", GB: "GB", JP: "JP", CN: "CN", CA: "CA" };

const SOURCE = {
  bls: { name: "U.S. Bureau of Labor Statistics", url: "https://data.bls.gov/timeseries" },
  worldBank: { name: "World Bank", url: "https://data.worldbank.org/indicator" },
  eurostat: { name: "Eurostat", url: "https://ec.europa.eu/eurostat/databrowser" },
  oecd: { name: "OECD", url: "https://data-explorer.oecd.org" },
  ecb: { name: "ECB", url: "https://data.ecb.europa.eu/data/datasets/FM/FM.D.U2.EUR.4F.KR.DFR.LEV" },
  fed: { name: "New York Fed", url: "https://www.newyorkfed.org/markets/reference-rates/effr" },
  treasury: { name: "U.S. Treasury", url: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed" },
} as const;

const WORLD_BANK: Record<string, string> = {
  inflation: "FP.CPI.TOTL.ZG",
  "gdp-growth": "NY.GDP.MKTP.KD.ZG",
  unemployment: "SL.UEM.TOTL.ZS",
  "current-account": "BN.CAB.XOKA.GD.ZS",
};

const OECD_ECONOMIC: Record<string, { dataflows: string[]; key: (country: string) => string; sourceUrl: string }> = {
  "cpi-index": {
    dataflows: [
      "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
      "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
    ],
    key: (country) => `${country}.M.N.CPI.IX._T.N._Z`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.TPS&df%5Bid%5D=DSD_PRICES%40DF_PRICES_ALL",
  },
  inflation: {
    dataflows: [
      "OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0",
      "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
    ],
    key: (country) => `${country}.M.N.CPI.PA._T.N.GY`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.TPS&df%5Bid%5D=DSD_PRICES%40DF_PRICES_ALL",
  },
  "gdp-growth": {
    dataflows: ["OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_G20,1.1"],
    key: (country) => `Q..${country}.S1..B1GQ......G1.`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.NAD&df%5Bid%5D=DSD_NAMAIN1%40DF_QNA_EXPENDITURE_GROWTH_G20",
  },
  unemployment: {
    dataflows: ["OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0"],
    key: (country) => `${country}..._Z.Y._T.Y_GE15..M`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.TPS&df%5Bid%5D=DSD_LFS%40DF_IALFS_UNE_M",
  },
};

function startPeriod(range: HistoryRange, frequency: MacroSeriesDefinition["frequency"], maxYear = 1990) {
  const now = new Date();
  if (range === "MAX") {
    if (frequency === "Monthly") return `${maxYear}-01`;
    if (frequency === "Quarterly") return `${maxYear}-Q1`;
    if (frequency === "Daily") return `${maxYear}-01-01`;
    return String(maxYear);
  }
  const year = now.getUTCFullYear() - ({ "1Y": 1, "5Y": 5, "10Y": 10 }[range]);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  if (frequency === "Monthly") return `${year}-${month}`;
  if (frequency === "Quarterly") return `${year}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
  if (frequency === "Daily") return `${year}-${month}-${day}`;
  return String(year);
}

function unique(points: MacroObservation[]) {
  return [...new Map(points.filter((point) => Number.isFinite(point.value)).map((point) => [point.date, point])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function text(url: string, accept: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "FinScope/1.0 macro history" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return response.text();
    const retryable = response.status === 429 || response.status >= 500;
    const status = response.status;
    await response.body?.cancel();
    if (!retryable || attempt === 2) throw new Error(`Official source returned ${status}.`);
    const retryAfter = Number(response.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1_000, 2_000)
      : 250 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Official source is temporarily unavailable.");
}

async function json(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "FinScope/1.0 macro history" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Official source returned ${response.status}.`);
  return response.json();
}

async function blsHistory(definition: MacroSeriesDefinition, range: HistoryRange) {
  const inflation = definition.id === "inflation";
  const consumerPrices = inflation || definition.id === "cpi-index";
  const series = consumerPrices ? "CUUR0000SA0" : "LNS14000000";
  const current = new Date().getUTCFullYear();
  const firstYear = consumerPrices ? 1913 : 1948;
  const displayedStartPeriod = range === "MAX" ? `${firstYear}-01` : startPeriod(range, "Monthly", firstYear);
  const displayedStart = Number(displayedStartPeriod.slice(0, 4));
  const queryStart = inflation ? displayedStart - 1 : displayedStart;
  const chunks: Array<{ start: number; end: number }> = [];
  for (let start = queryStart; start <= current; start += 10) chunks.push({ start, end: Math.min(start + 9, current) });
  const observations: MacroObservation[] = [];
  for (const chunk of chunks) {
    const url = `https://api.bls.gov/publicAPI/v2/timeseries/data/${series}?startyear=${chunk.start}&endyear=${chunk.end}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FinScope/1.0 macro history" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`BLS returned ${response.status}.`);
    const payload = await response.json() as {
      status?: string;
      Results?: { series?: Array<{ data?: Array<{ year?: string; period?: string; value?: string }> }> };
    };
    if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("BLS did not return historical observations.");
    observations.push(...parseBlsObservations(payload.Results?.series?.[0]?.data ?? []));
  }
  const calculated = inflation ? yearOverYearObservations(unique(observations)) : unique(observations);
  return {
    definition,
    source: SOURCE.bls.name,
    sourceUrl: `${SOURCE.bls.url}/${series}`,
    observations: calculated.filter((point) => point.date >= displayedStartPeriod),
  };
}

async function worldBankHistory(country: MacroCountry, definition: MacroSeriesDefinition, range: HistoryRange) {
  const series = WORLD_BANK[definition.id];
  if (!series) return null;
  const start = startPeriod(range, "Annual", 1960);
  const url = `https://api.worldbank.org/v2/country/${country.worldBank}/indicator/${series}?format=json&per_page=1000&date=${start}:${new Date().getUTCFullYear()}`;
  const observations = parseWorldBankObservations(await json(url));
  return {
    definition: {
      ...definition,
      frequency: "Annual" as const,
      ...(definition.id === "gdp-growth" ? { note: "Real output · year over year" } : {}),
      ...(definition.id === "cpi-index" ? { note: CPI_INDEX_SERIES.note } : {}),
    },
    source: SOURCE.worldBank.name,
    sourceUrl: `${SOURCE.worldBank.url}/${series}`,
    observations,
  };
}

async function eurostatHistory(country: MacroCountry, definition: MacroSeriesDefinition, range: HistoryRange) {
  if (!country.eurostat) return null;
  const config = definition.id === "cpi-index"
    ? { definition: CPI_INDEX_SERIES, dataset: "prc_hicp_minr", parameters: "coicop18=TOTAL&unit=I25" }
    : EUROSTAT_SERIES.find((candidate) => candidate.definition.id === definition.id);
  if (!config) return null;
  const urls = eurostatUrls(config.dataset, country.eurostat, config.parameters, config.definition.frequency);
  const api = new URL(urls.api);
  api.searchParams.set("sinceTimePeriod", startPeriod(range, config.definition.frequency, 1990));
  return {
    definition: config.definition,
    source: SOURCE.eurostat.name,
    sourceUrl: urls.source,
    observations: parseEurostatObservations(await json(api.toString())),
  };
}

async function oecdEconomicHistory(country: MacroCountry, definition: MacroSeriesDefinition, range: HistoryRange) {
  const config = OECD_ECONOMIC[definition.id];
  if (!country.oecd || !config) return null;
  const start = startPeriod(range, definition.frequency, 1990);
  let observations: MacroObservation[] = [];
  let lastFailure = "";
  if (definition.id === CPI_INDEX_SERIES.id) {
    try {
      const proxy = `${MACRO_SOURCE_URL}/oecd/cpi?country=${encodeURIComponent(country.oecd)}`;
      observations = parseSdmxCsvObservations(await text(proxy, "text/csv")).filter((point) => point.date >= start);
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : "OECD is temporarily unavailable.";
    }
  }
  for (const dataflow of config.dataflows) {
    if (observations.length) break;
    try {
      const url = `https://sdmx.oecd.org/public/rest/data/${dataflow}/${config.key(country.oecd)}?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
      observations = parseSdmxCsvObservations(await text(url, "text/csv"));
      if (observations.length) break;
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : "OECD is temporarily unavailable.";
      // The other OECD classification may still carry this country.
    }
  }
  if (!observations.length && lastFailure) throw new Error(lastFailure);
  return {
    definition,
    source: SOURCE.oecd.name,
    sourceUrl: config.sourceUrl,
    observations,
  };
}

async function imfCpiHistory(country: MacroCountry, range: HistoryRange) {
  const area = IMF_AREA[country.code];
  if (!area) return null;
  const series = `M.${area}.PCPI_IX`;
  const url = `https://api.db.nomics.world/v22/series/IMF/IFS/${series}?observations=1`;
  const payload = await json(url) as {
    series?: { docs?: Array<{ period?: string[]; value?: Array<number | null> }> };
  };
  const document = payload.series?.docs?.[0];
  const start = startPeriod(range, "Monthly", 1990);
  const observations = (document?.period ?? []).flatMap((date, index) => {
    const raw = document?.value?.[index];
    const value = Number(raw);
    return date >= start && raw != null && Number.isFinite(value) ? [{ date, value }] : [];
  });
  return {
    definition: CPI_INDEX_SERIES,
    source: "IMF IFS via DBnomics",
    sourceUrl: `https://db.nomics.world/IMF/IFS/${series}`,
    observations,
  };
}

async function oecdCliHistory(country: MacroCountry, range: HistoryRange) {
  if (!country.oecd) return null;
  const start = startPeriod(range, OECD_SERIES.frequency, 1990);
  const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/${country.oecd}.M.LI...AA...H?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
  return {
    definition: OECD_SERIES,
    source: SOURCE.oecd.name,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.STES&df%5Bid%5D=DSD_STES%40DF_CLI",
    observations: parseSdmxCsvObservations(await text(url, "text/csv")),
  };
}

async function ecbHistory(range: HistoryRange) {
  const start = startPeriod(range, ECB_RATE_SERIES.frequency, 1999);
  const url = `https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=${start}`;
  return {
    definition: ECB_RATE_SERIES,
    source: SOURCE.ecb.name,
    sourceUrl: SOURCE.ecb.url,
    observations: parseSdmxCsvObservations(await text(url, "text/csv")),
  };
}

async function fedHistory(range: HistoryRange) {
  const start = startPeriod(range, "Daily", 2000);
  const end = new Date().toISOString().slice(0, 10);
  const payload = await json(`https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=${start}&endDate=${end}&type=rate`) as {
    refRates?: Array<{ effectiveDate?: string; percentRate?: number }>;
  };
  return {
    definition: US_RATE_SERIES[0],
    source: SOURCE.fed.name,
    sourceUrl: SOURCE.fed.url,
    observations: unique((payload.refRates ?? []).flatMap((point) => {
      const value = Number(point.percentRate);
      return point.effectiveDate && Number.isFinite(value) ? [{ date: point.effectiveDate, value }] : [];
    })),
  };
}

async function treasuryHistory(definition: MacroSeriesDefinition, range: HistoryRange) {
  const start = startPeriod(range, "Daily", 1990);
  const first = Number(start.slice(0, 4));
  const last = new Date().getUTCFullYear();
  const years = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const observations: MacroObservation[] = [];
  // Five at a time stays below a Worker's six-open-connection limit.
  for (let index = 0; index < years.length; index += 5) {
    const batch = await Promise.all(years.slice(index, index + 5).map(async (year) => {
      try {
        const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
        return parseTreasuryHistory(await text(url, "application/xml"), definition.id as TreasurySeriesId);
      } catch {
        return [];
      }
    }));
    observations.push(...batch.flat());
  }
  return {
    definition,
    source: SOURCE.treasury.name,
    sourceUrl: SOURCE.treasury.url,
    observations: unique(observations).filter((point) => point.date >= start),
  };
}

async function buildHistory(country: MacroCountry, definition: MacroSeriesDefinition, range: HistoryRange): Promise<MacroHistory> {
  try {
    let lastFailure = "";
    const attempt = async <T,>(read: () => Promise<T>): Promise<T | null> => {
      try { return await read(); } catch (cause) {
        lastFailure = cause instanceof Error ? cause.message : "Official source is temporarily unavailable.";
        return null;
      }
    };
    let result = null;
    if (definition.id === "ecb-rate") result = await ecbHistory(range);
    else if (definition.id === "oecd-cli") result = await oecdCliHistory(country, range);
    else if (definition.id === "fed-funds") result = await fedHistory(range);
    else if (definition.id.startsWith("treasury-") || definition.id === "curve") result = await treasuryHistory(definition, range);
    else if (definition.id === "current-account") result = await worldBankHistory(country, definition, range);
    else {
      if (country.code === "US" && (definition.id === "cpi-index" || definition.id === "inflation" || definition.id === "unemployment")) {
        result = await attempt(() => blsHistory(definition, range));
      }
      if (!result?.observations.length) result = await attempt(() => eurostatHistory(country, definition, range));
      if (!result?.observations.length) result = await attempt(() => oecdEconomicHistory(country, definition, range));
      if (!result?.observations.length && definition.id === CPI_INDEX_SERIES.id) result = await attempt(() => imfCpiHistory(country, range));
      if (!result?.observations.length) result = await attempt(() => worldBankHistory(country, definition, range));
    }
    if (!result?.observations.length) throw new Error(lastFailure || "No historical observation is available from the official source.");
    const observations = unique(result.observations);
    return {
      country: { code: country.code, name: country.name },
      indicator: { ...result.definition, source: result.source, sourceUrl: result.sourceUrl },
      observations: definition.id === "cpi-index" ? rebaseObservations(observations) : observations,
    };
  } catch (cause) {
    return {
      country: { code: country.code, name: country.name },
      indicator: { ...definition, source: "Official release", sourceUrl: "" },
      observations: [],
      error: cause instanceof Error ? cause.message : "Historical data is unavailable.",
    };
  }
}

function parseCachedHistory(body: string | null) {
  if (!body) return null;
  try {
    const history = JSON.parse(body) as MacroHistory;
    return history.observations.length ? history : null;
  } catch {
    return null;
  }
}

function latestObservationDate(history: MacroHistory | null) {
  return history?.observations.at(-1)?.date ?? "";
}

function bestCachedHistoryBody(...bodies: Array<string | null>) {
  let best: { body: string; history: MacroHistory } | null = null;
  for (const body of bodies) {
    const history = parseCachedHistory(body);
    if (!body || !history) continue;
    const isNewer = latestObservationDate(history) > latestObservationDate(best?.history ?? null);
    const isBroaderAtSameDate = latestObservationDate(history) === latestObservationDate(best?.history ?? null)
      && history.observations.length > (best?.history.observations.length ?? 0);
    if (!best || isNewer || isBroaderAtSameDate) best = { body, history };
  }
  return best?.body ?? null;
}

function sliceHistory(history: MacroHistory, range: HistoryRange) {
  const start = startPeriod(range, "Monthly", 1990);
  const observations = rebaseObservations(history.observations.filter((point) => point.date >= start));
  return observations.length ? { ...history, observations } : null;
}

function joinCpiHistories(historical: MacroHistory, recent: MacroHistory) {
  const historicalValues = new Map(historical.observations.map((point) => [point.date, point.value]));
  const overlap = recent.observations.find((point) => historicalValues.has(point.date) && point.value !== 0);
  if (!overlap) return historical;
  const scale = (historicalValues.get(overlap.date) as number) / overlap.value;
  const observations = unique([
    ...historical.observations.filter((point) => point.date < overlap.date),
    ...recent.observations.filter((point) => point.date >= overlap.date).map((point) => ({ ...point, value: point.value * scale })),
  ]);
  return {
    ...historical,
    indicator: {
      ...historical.indicator,
      source: [...new Set([
        ...historical.indicator.source.split(" · "),
        ...recent.indicator.source.split(" · "),
      ])].join(" · "),
      note: CPI_INDEX_SERIES.note,
    },
    observations,
  };
}

async function cachedHistory(
  country: MacroCountry,
  definition: MacroSeriesDefinition,
  range: HistoryRange,
): Promise<{ body: string; cache: "hit" | "miss" | "stale" }> {
  const cache = datasetCache();
  const freshVersion = definition.id === CPI_INDEX_SERIES.id ? "v9" : "v3";
  const freshKey = marketKey(`macro-history:${country.code}:${definition.id}:${range}:${freshVersion}`);
  const snapshotKey = marketKey(`macro-history-snapshot:${country.code}:${definition.id}:${range}:v1`);
  const legacyVersion = country.code === "US" ? "v5" : "v4";
  const legacyKey = marketKey(`macro-history:${country.code}:${definition.id}:${range}:${legacyVersion}`);
  const read = async (key: string) => {
    try { return await cache?.get(key, "text") ?? null; } catch { return null; }
  };
  const fresh = await read(freshKey);
  if (fresh) return { body: fresh, cache: "hit" };
  const snapshotEntry = await read(snapshotKey);
  const legacyEntry = definition.id === CPI_INDEX_SERIES.id ? await read(legacyKey) : null;
  const snapshot = bestCachedHistoryBody(snapshotEntry, legacyEntry);
  const recentSnapshot = definition.id === CPI_INDEX_SERIES.id
    ? bestCachedHistoryBody(
      range === "5Y"
        ? snapshotEntry
        : await read(marketKey(`macro-history-snapshot:${country.code}:${definition.id}:5Y:v1`)),
      range === "5Y"
        ? legacyEntry
        : await read(marketKey(`macro-history:${country.code}:${definition.id}:5Y:${legacyVersion}`)),
    )
    : null;
  let answer = await buildHistory(country, definition, range);
  const recent = parseCachedHistory(recentSnapshot);
  const recentForRange = recent ? sliceHistory(recent, range) : null;
  if (
    recentForRange
    && answer.observations.length
    && answer.indicator.source.includes("DBnomics")
    && latestObservationDate(recentForRange) > latestObservationDate(answer)
  ) {
    answer = joinCpiHistories(answer, recentForRange);
  } else if (recentForRange && !answer.observations.length) {
    answer = recentForRange;
  }
  if (answer.observations.length) {
    const body = JSON.stringify(answer);
    try { await cache?.put(freshKey, body, { expirationTtl: 21_600 }); } catch { /* Cache writes are best-effort. */ }
    try { await cache?.put(snapshotKey, body, { expirationTtl: 2_592_000 }); } catch { /* Keep serving the answer. */ }
    return { body, cache: "miss" };
  }
  if (snapshot) {
    try { await cache?.put(snapshotKey, snapshot, { expirationTtl: 2_592_000 }); } catch { /* The legacy entry is still usable. */ }
    return { body: snapshot, cache: "stale" };
  }
  return { body: JSON.stringify(answer), cache: "miss" };
}

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const countryCode = parameters.get("country")?.toUpperCase() ?? "US";
  const seriesId = parameters.get("series") ?? "inflation";
  const requestedRange = parameters.get("range")?.toUpperCase() ?? "10Y";
  const country = MACRO_COUNTRIES.find((candidate) => candidate.code === countryCode);
  const definition = seriesId === CPI_INDEX_SERIES.id
    ? CPI_INDEX_SERIES
    : macroDefinitionsFor(countryCode).find((candidate) => candidate.id === seriesId);
  if (!country || !definition || !(["1Y", "5Y", "10Y", "MAX"] as string[]).includes(requestedRange)) {
    return Response.json({ error: "Unknown macro history request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const range = requestedRange as HistoryRange;
  const { body, cache } = await cachedHistory(country, definition, range);
  const answer = JSON.parse(body) as MacroHistory;
  return new Response(body, {
    status: answer.error ? 502 : 200,
    headers: {
      ...responseHeaders,
      ...(answer.error ? { "Cache-Control": "no-store" } : {}),
      "X-FinScope-Cache": cache,
    },
  });
}
