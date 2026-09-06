import { NextResponse } from "next/server";
import {
  MACRO_SERIES,
  parseTreasuryRates,
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
  const ids = ["treasury-3m", "treasury-2y", "treasury-10y", "treasury-30y", "curve"];
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
    return [
      indicator("treasury-3m", { date: rates.date, value: rates.threeMonth }),
      indicator("treasury-2y", { date: rates.date, value: rates.twoYear }),
      indicator("treasury-10y", { date: rates.date, value: rates.tenYear }),
      indicator("treasury-30y", { date: rates.date, value: rates.thirtyYear }),
      indicator("curve", { date: rates.date, value: rates.tenYear - rates.twoYear }),
    ];
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unavailable.";
    return ids.map((id) => indicator(id, null, message));
  }
}

export async function GET() {
  const [fedFunds, treasury] = await Promise.all([readFedFunds(), readTreasury()]);
  const unordered = [fedFunds, ...treasury];
  const indicators = MACRO_SERIES.map((series) => unordered.find((candidate) => candidate.id === series.id) ?? indicator(series.id, null, "Unavailable."));
  const available = indicators.some((item) => item.value != null);
  return NextResponse.json(
    { indicators, ...(available ? {} : { error: "Macro data is unavailable right now." }) },
    { status: available ? 200 : 502, headers: available ? headers : { "Cache-Control": "no-store" } },
  );
}
