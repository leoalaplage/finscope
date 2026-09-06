import {
  COMMON_MACRO_SERIES,
  ECB_RATE_SERIES,
  EUROSTAT_SERIES,
  MACRO_COUNTRIES,
  OECD_SERIES,
  US_RATE_SERIES,
  eurostatUrls,
  macroDefinitionsFor,
  parseBlsObservations,
  parseEurostatObservation,
  parseSdmxCsvObservation,
  parseTreasuryRates,
  parseWorldBankObservation,
  yearOverYearObservations,
  type MacroCountry,
  type MacroIndicator,
  type MacroObservation,
  type MacroSeriesDefinition,
} from "@/lib/macro";
import { cachedJson, type Completeness } from "@/lib/market-cache";

const responseHeaders = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Accept-Encoding",
};

const SOURCE = {
  bls: "U.S. Bureau of Labor Statistics",
  worldBank: "World Bank",
  eurostat: "Eurostat",
  ecb: "ECB",
  oecd: "OECD",
  fed: "New York Fed",
  treasury: "U.S. Treasury",
} as const;

async function readBls(): Promise<MacroIndicator[]> {
  const configurations = [
    { definition: COMMON_MACRO_SERIES[0], series: "CUUR0000SA0", sourceUrl: "https://data.bls.gov/timeseries/CUUR0000SA0" },
    { definition: COMMON_MACRO_SERIES[2], series: "LNS14000000", sourceUrl: "https://data.bls.gov/timeseries/LNS14000000" },
  ] as const;
  try {
    const year = new Date().getUTCFullYear();
    const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "FinScope/1.0 macro dashboard" },
      body: JSON.stringify({ seriesid: configurations.map((item) => item.series), startyear: String(year - 2), endyear: String(year) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`BLS returned ${response.status}.`);
    const payload = await response.json() as {
      status?: string;
      Results?: { series?: Array<{ seriesID?: string; data?: Array<{ year?: string; period?: string; value?: string }> }> };
    };
    if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("BLS did not return current observations.");
    const series = new Map((payload.Results?.series ?? []).map((item) => [item.seriesID, parseBlsObservations(item.data ?? [])]));
    return configurations.map((configuration) => {
      const levels = series.get(configuration.series) ?? [];
      const observations = configuration.definition.id === "inflation" ? yearOverYearObservations(levels) : levels;
      const observation = observations.at(-1) ?? null;
      return observation
        ? makeIndicator(configuration.definition, SOURCE.bls, configuration.sourceUrl, observation)
        : unavailable(configuration.definition, SOURCE.bls, configuration.sourceUrl, "No recent observation.");
    });
  } catch (cause) {
    return configurations.map((configuration) => unavailable(configuration.definition, SOURCE.bls, configuration.sourceUrl, cause));
  }
}

interface MacroAnswer {
  country: Pick<MacroCountry, "code" | "name">;
  indicators: MacroIndicator[];
  error?: string;
}

function makeIndicator(
  definition: MacroSeriesDefinition,
  source: string,
  sourceUrl: string,
  observation: MacroObservation | null,
  error?: string,
): MacroIndicator {
  return {
    ...definition,
    value: observation?.value ?? null,
    date: observation?.date ?? null,
    source,
    sourceUrl,
    ...(error ? { error } : {}),
  };
}

function unavailable(
  definition: MacroSeriesDefinition,
  source: string,
  sourceUrl: string,
  cause: unknown,
) {
  return makeIndicator(definition, source, sourceUrl, null, cause instanceof Error ? cause.message : "Unavailable.");
}

const WORLD_BANK_INDICATORS = [
  { definition: { ...COMMON_MACRO_SERIES[0], frequency: "Annual" as const }, series: "FP.CPI.TOTL.ZG" },
  { definition: { ...COMMON_MACRO_SERIES[1], note: "Real output · year over year", frequency: "Annual" as const }, series: "NY.GDP.MKTP.KD.ZG" },
  { definition: { ...COMMON_MACRO_SERIES[2], frequency: "Annual" as const }, series: "SL.UEM.TOTL.ZS" },
  { definition: COMMON_MACRO_SERIES[3], series: "BN.CAB.XOKA.GD.ZS" },
] as const;

async function readWorldBank(country: MacroCountry): Promise<MacroIndicator[]> {
  const year = new Date().getUTCFullYear();
  return Promise.all(WORLD_BANK_INDICATORS.map(async ({ definition, series }) => {
    const sourceUrl = `https://data.worldbank.org/indicator/${series}`;
    try {
      const response = await fetch(`https://api.worldbank.org/v2/country/${country.worldBank}/indicator/${series}?format=json&per_page=10&date=${year - 8}:${year}`, {
        headers: { Accept: "application/json", "User-Agent": "FinScope/1.0 macro dashboard" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`World Bank returned ${response.status}.`);
      const observation = parseWorldBankObservation(await response.json());
      if (!observation) throw new Error("No recent observation.");
      return makeIndicator(definition, SOURCE.worldBank, sourceUrl, observation);
    } catch (cause) {
      return unavailable(definition, SOURCE.worldBank, sourceUrl, cause);
    }
  }));
}

async function readEurostat(country: MacroCountry): Promise<MacroIndicator[]> {
  if (!country.eurostat) return [];
  const indicators: MacroIndicator[] = [];
  for (const { definition, dataset, parameters } of EUROSTAT_SERIES) {
    const urls = eurostatUrls(dataset, country.eurostat, parameters, definition.frequency);
    try {
      const response = await fetch(urls.api, {
        headers: { Accept: "application/json", "User-Agent": "FinScope/1.0 macro dashboard" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Eurostat returned ${response.status}.`);
      const observation = parseEurostatObservation(await response.json());
      if (!observation) throw new Error("No recent observation.");
      indicators.push(makeIndicator(definition, SOURCE.eurostat, urls.source, observation));
    } catch (cause) {
      indicators.push(unavailable(definition, SOURCE.eurostat, urls.source, cause));
    }
  }
  return indicators;
}

const OECD_ECONOMIC = [
  {
    definition: COMMON_MACRO_SERIES[0],
    dataflow: "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0",
    key: (country: string) => `${country}.M.N.CPI.PA._T.N.GY`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.TPS&df%5Bid%5D=DSD_PRICES%40DF_PRICES_ALL",
  },
  {
    definition: COMMON_MACRO_SERIES[1],
    dataflow: "OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_G20,1.1",
    key: (country: string) => `Q..${country}.S1..B1GQ......G1.`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.NAD&df%5Bid%5D=DSD_NAMAIN1%40DF_QNA_EXPENDITURE_GROWTH_G20",
  },
  {
    definition: COMMON_MACRO_SERIES[2],
    dataflow: "OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0",
    key: (country: string) => `${country}..._Z.Y._T.Y_GE15..M`,
    sourceUrl: "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.TPS&df%5Bid%5D=DSD_LFS%40DF_IALFS_UNE_M",
  },
] as const;

async function readOecdEconomic(country: MacroCountry): Promise<MacroIndicator[]> {
  if (!country.oecd) return [];
  const year = new Date().getUTCFullYear();
  return Promise.all(OECD_ECONOMIC.map(async ({ definition, dataflow, key, sourceUrl }) => {
    try {
      const start = definition.frequency === "Quarterly" ? `${year - 2}-Q1` : `${year - 2}-01`;
      const url = `https://sdmx.oecd.org/public/rest/data/${dataflow}/${key(country.oecd as string)}?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
      const response = await fetch(url, {
        headers: { Accept: "text/csv", "User-Agent": "FinScope/1.0 macro dashboard" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`OECD returned ${response.status}.`);
      const observation = parseSdmxCsvObservation(await response.text());
      if (!observation) throw new Error("No recent observation.");
      return makeIndicator(definition, SOURCE.oecd, sourceUrl, observation);
    } catch (cause) {
      return unavailable(definition, SOURCE.oecd, sourceUrl, cause);
    }
  }));
}

async function readEcb(): Promise<MacroIndicator> {
  const sourceUrl = "https://data.ecb.europa.eu/data/datasets/FM/FM.D.U2.EUR.4F.KR.DFR.LEV";
  try {
    const response = await fetch("https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&lastNObservations=1", {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`ECB returned ${response.status}.`);
    const observation = parseSdmxCsvObservation(await response.text());
    if (!observation) throw new Error("No current observation.");
    return makeIndicator(ECB_RATE_SERIES, SOURCE.ecb, sourceUrl, observation);
  } catch (cause) {
    return unavailable(ECB_RATE_SERIES, SOURCE.ecb, sourceUrl, cause);
  }
}

async function readOecd(country: MacroCountry): Promise<MacroIndicator | null> {
  if (!country.oecd) return null;
  const sourceUrl = "https://data-explorer.oecd.org/vis?df%5Bag%5D=OECD.SDD.STES&df%5Bid%5D=DSD_STES%40DF_CLI";
  try {
    const start = `${new Date().getUTCFullYear() - 2}-01`;
    const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/${country.oecd}.M.LI...AA...H?startPeriod=${start}&dimensionAtObservation=AllDimensions&format=csvfile`;
    const response = await fetch(url, {
      headers: { Accept: "text/csv", "User-Agent": "FinScope/1.0 macro dashboard" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`OECD returned ${response.status}.`);
    const observation = parseSdmxCsvObservation(await response.text());
    if (!observation) throw new Error("No recent observation.");
    return makeIndicator(OECD_SERIES, SOURCE.oecd, sourceUrl, observation);
  } catch {
    // OECD rejects some cloud/VPN traffic. The comparable World Bank series
    // remain usable, so an optional leading indicator must not delay or fail
    // the whole country snapshot.
    return null;
  }
}

async function readFedFunds(): Promise<MacroIndicator> {
  const definition = US_RATE_SERIES[0];
  const sourceUrl = "https://www.newyorkfed.org/markets/reference-rates/effr";
  try {
    const response = await fetch("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`New York Fed returned ${response.status}.`);
    const payload = await response.json() as { refRates?: Array<{ effectiveDate?: string; percentRate?: number }> };
    const point = payload.refRates?.[0];
    const value = Number(point?.percentRate);
    if (!point?.effectiveDate || !Number.isFinite(value)) throw new Error("No current observation.");
    return makeIndicator(definition, SOURCE.fed, sourceUrl, { date: point.effectiveDate, value });
  } catch (cause) {
    return unavailable(definition, SOURCE.fed, sourceUrl, cause);
  }
}

async function readTreasury(): Promise<MacroIndicator[]> {
  const definitions = US_RATE_SERIES.slice(1);
  const sourceUrl = "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed";
  try {
    const year = new Date().getUTCFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
    const response = await fetch(url, {
      headers: { Accept: "application/xml", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`U.S. Treasury returned ${response.status}.`);
    const rates = parseTreasuryRates(await response.text());
    if (!rates) throw new Error("No current observation.");
    const values = [rates.threeMonth, rates.twoYear, rates.tenYear, rates.thirtyYear, rates.tenYear - rates.twoYear];
    return definitions.map((definition, index) => makeIndicator(definition, SOURCE.treasury, sourceUrl, { date: rates.date, value: values[index] }));
  } catch (cause) {
    return definitions.map((definition) => unavailable(definition, SOURCE.treasury, sourceUrl, cause));
  }
}

async function buildAnswer(country: MacroCountry): Promise<MacroAnswer> {
  // A Worker may keep at most six outbound connections open at once. Read the
  // high-frequency providers first (at most five concurrent requests), then
  // the four World Bank series, so no provider is silently starved.
  const [eurostat, ecb, oecd, fedFunds, treasury] = await Promise.all([
    readEurostat(country),
    country.ecb ? readEcb() : Promise.resolve(null),
    readOecd(country),
    country.code === "US" ? readFedFunds() : Promise.resolve(null),
    country.code === "US" ? readTreasury() : Promise.resolve([]),
  ]);
  const oecdEconomic = await readOecdEconomic(country);
  const bls = country.code === "US" ? await readBls() : [];
  const worldBank = await readWorldBank(country);

  // Monthly/quarterly Eurostat releases replace the equivalent annual World
  // Bank cards; the latter remains the global fallback and current account.
  const preferred = [...worldBank, ...oecdEconomic, ...bls, ...eurostat, ...(ecb ? [ecb] : []), ...(oecd ? [oecd] : []), ...(fedFunds ? [fedFunds] : []), ...treasury];
  const indicators = macroDefinitionsFor(country.code).flatMap((definition) => {
    const candidates = preferred.filter((candidate) => candidate.id === definition.id);
    const available = candidates.findLast((candidate) => candidate.value != null);
    const fallback = candidates.at(-1);
    return available ?? fallback ?? [];
  });
  const available = indicators.some((indicator) => indicator.value != null);
  return {
    country: { code: country.code, name: country.name },
    indicators,
    ...(available ? {} : { error: "Macro data is unavailable right now." }),
  };
}

function completeness(answer: MacroAnswer): Completeness {
  const available = answer.indicators.filter((indicator) => indicator.value != null).length;
  if (available === 0) return "empty";
  return available >= 4 ? "full" : "partial";
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("country")?.toUpperCase() ?? "US";
  const country = MACRO_COUNTRIES.find((candidate) => candidate.code === requested);
  if (!country) {
    return Response.json({ error: "Unknown country." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { body, hit } = await cachedJson(`macro:${country.code}:v7`, 21_600, () => buildAnswer(country), completeness);
  const answer = JSON.parse(body) as MacroAnswer;
  return new Response(body, {
    status: answer.error ? 502 : 200,
    headers: {
      ...responseHeaders,
      ...(answer.error ? { "Cache-Control": "no-store" } : {}),
      "X-FinScope-Cache": hit ? "hit" : "miss",
    },
  });
}
