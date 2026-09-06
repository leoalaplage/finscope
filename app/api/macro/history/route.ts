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
import { cachedJson, type Completeness } from "@/lib/market-cache";

type HistoryRange = "1Y" | "5Y" | "10Y" | "MAX";

const responseHeaders = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Accept-Encoding",
};

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
  "cpi-index": "FP.CPI.TOTL",
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
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "FinScope/1.0 macro history" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Official source returned ${response.status}.`);
  return response.text();
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
    const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "FinScope/1.0 macro history" },
      body: JSON.stringify({ seriesid: [series], startyear: String(chunk.start), endyear: String(chunk.end) }),
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
  for (const dataflow of config.dataflows) {
    try {
      const url = `https://sdmx.oecd.org/public/rest/data/${dataflow}/${config.key(country.oecd)}?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
      observations = parseSdmxCsvObservations(await text(url, "text/csv"));
      if (observations.length) break;
    } catch { /* The other OECD classification may still carry this country. */ }
  }
  return {
    definition,
    source: SOURCE.oecd.name,
    sourceUrl: config.sourceUrl,
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
    const attempt = async <T,>(read: () => Promise<T>): Promise<T | null> => {
      try { return await read(); } catch { return null; }
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
      if (!result?.observations.length) result = await attempt(() => worldBankHistory(country, definition, range));
    }
    if (!result?.observations.length) throw new Error("No historical observation is available from the official source.");
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

function completeness(answer: MacroHistory): Completeness {
  return answer.observations.length ? "full" : "empty";
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
  const cacheVersion = definition.id === CPI_INDEX_SERIES.id ? "v4" : "v3";
  const { body, hit } = await cachedJson(
    `macro-history:${country.code}:${definition.id}:${range}:${cacheVersion}`,
    21_600,
    () => buildHistory(country, definition, range),
    completeness,
  );
  const answer = JSON.parse(body) as MacroHistory;
  return new Response(body, {
    status: answer.error ? 502 : 200,
    headers: {
      ...responseHeaders,
      ...(answer.error ? { "Cache-Control": "no-store" } : {}),
      "X-FinScope-Cache": hit ? "hit" : "miss",
    },
  });
}
