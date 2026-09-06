import { NextResponse } from "next/server";
import {
  latestObservation,
  MACRO_SERIES,
  parseBlsObservations,
  parseTreasuryCurve,
  yearOverYearObservation,
  type MacroIndicator,
  type MacroObservation,
} from "@/lib/macro";

const headers = {
  "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
  Vary: "Accept-Encoding",
};

function definition(id: string) {
  const found = MACRO_SERIES.find((series) => series.id === id);
  if (!found) throw new Error(`Unknown macro series: ${id}`);
  return found;
}

function indicator(id: string, observation: MacroObservation | null, error?: string): MacroIndicator {
  return { ...definition(id), value: observation?.value ?? null, date: observation?.date ?? null, ...(error ? { error } : {}) };
}

function currentYears() {
  const year = new Date().getUTCFullYear();
  return { startyear: String(year - 1), endyear: String(year) };
}

async function readBls(): Promise<MacroIndicator[]> {
  const ids = ["cpi", "unemployment", "wages"];
  try {
    const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ seriesid: ids.map((id) => definition(id).series), ...currentYears() }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`BLS returned ${response.status}.`);
    const payload = await response.json() as {
      status?: string;
      Results?: { series?: Array<{ seriesID?: string; data?: Array<{ year?: string; period?: string; value?: string }> }> };
    };
    if (payload.status !== "REQUEST_SUCCEEDED") throw new Error("BLS did not return current observations.");
    const observations = new Map((payload.Results?.series ?? []).map((series) => [series.seriesID, parseBlsObservations(series.data ?? [])]));
    return ids.map((id) => {
      const series = observations.get(definition(id).series) ?? [];
      const value = id === "unemployment" ? latestObservation(series) : yearOverYearObservation(series);
      return indicator(id, value, value ? undefined : "No current observation.");
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unavailable.";
    return ids.map((id) => indicator(id, null, message));
  }
}

async function readFedFunds(): Promise<MacroIndicator> {
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
    return indicator("fed-funds", { date: point.effectiveDate, value });
  } catch (cause) {
    return indicator("fed-funds", null, cause instanceof Error ? cause.message : "Unavailable.");
  }
}

async function readTreasury(): Promise<MacroIndicator[]> {
  try {
    const year = new Date().getUTCFullYear();
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
    const response = await fetch(url, {
      headers: { Accept: "application/xml", "User-Agent": "Mozilla/5.0 FinScope/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`U.S. Treasury returned ${response.status}.`);
    const curve = parseTreasuryCurve(await response.text());
    if (!curve) throw new Error("No current observation.");
    return [
      indicator("treasury-10y", { date: curve.date, value: curve.tenYear }),
      indicator("curve", { date: curve.date, value: curve.tenYear - curve.twoYear }),
    ];
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unavailable.";
    return [indicator("treasury-10y", null, message), indicator("curve", null, message)];
  }
}

export async function GET() {
  const [bls, fedFunds, treasury] = await Promise.all([readBls(), readFedFunds(), readTreasury()]);
  const unordered = [...bls, fedFunds, ...treasury];
  const indicators = MACRO_SERIES.map((series) => unordered.find((candidate) => candidate.id === series.id) ?? indicator(series.id, null, "Unavailable."));
  const available = indicators.some((item) => item.value != null);
  return NextResponse.json(
    { indicators, ...(available ? {} : { error: "Macro data is unavailable right now." }) },
    { status: available ? 200 : 502, headers: available ? headers : { "Cache-Control": "no-store" } },
  );
}
