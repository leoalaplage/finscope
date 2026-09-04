import { companyFundamentals } from "@/lib/api/v1/company";
import { companyForRoute } from "@/lib/api/v1/route-helpers";
import { FINANCIAL_DATA_VERSION } from "@/lib/api/v1/contracts";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";
import { parseV1Metrics } from "@/lib/api/v1/metrics";
import type { Periodicity } from "@/lib/types";

const FREQUENCIES = new Set<Periodicity>(["annual", "quarterly", "ttm"]);

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const url = new URL(request.url);
  const askedFrequency = url.searchParams.get("frequency") ?? "annual";
  if (!FREQUENCIES.has(askedFrequency as Periodicity)) {
    return v1Error(request, 400, "invalid_request", "frequency must be annual, quarterly, or ttm.", { retryable: false });
  }
  const { metrics, invalid } = parseV1Metrics(url.searchParams.get("metrics"));
  if (invalid.length || !metrics.length) {
    return v1Error(request, 400, "invalid_request", `Unsupported metrics: ${invalid.join(", ") || "none selected"}.`, {
      retryable: false,
      details: { invalid: invalid.join(",") },
    });
  }

  const { ticker } = await context.params;
  const read = await companyForRoute(request, ticker);
  if (read instanceof Response) return read;
  const frequency = askedFrequency as Periodicity;
  const data = companyFundamentals(read.dataset, metrics, frequency);
  const asOf = data.series.flatMap((series) => series.values).map((value) => value.periodEnd).sort().at(-1) ?? null;
  const warnings = [...read.dataset.warnings];
  if (!data.series.some((series) => series.values.length)) warnings.push(`No ${frequency} periods are available.`);
  if (read.cache === "previous-version") warnings.push("A previous compatible dataset version is being served while the current version is built.");
  return v1Response(request, data, {
    dataVersion: FINANCIAL_DATA_VERSION,
    asOf,
    retrievedAt: read.dataset.retrievedAt,
    currency: read.dataset.company.currency,
    frequency,
    status: "calculated",
    warnings,
  }, { cacheControl: read.cache === "current" ? V1_CACHE.financials : V1_CACHE.none });
}

