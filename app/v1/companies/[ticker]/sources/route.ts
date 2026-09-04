import { companyForRoute } from "@/lib/api/v1/route-helpers";
import { companySources } from "@/lib/api/v1/sources";
import { isV1Metric } from "@/lib/api/v1/metrics";
import { FINANCIAL_DATA_VERSION } from "@/lib/api/v1/contracts";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const url = new URL(request.url);
  const metric = url.searchParams.get("metric") ?? "";
  const period = url.searchParams.get("period");
  if (!isV1Metric(metric)) return v1Error(request, 400, "invalid_request", "A supported metric query parameter is required.", { retryable: false });
  if (period && period.length > 40) return v1Error(request, 400, "invalid_request", "period is too long.", { retryable: false });
  const { ticker } = await context.params;
  const read = await companyForRoute(request, ticker);
  if (read instanceof Response) return read;
  const data = companySources(read.dataset, metric, period);
  if (!data) return v1Error(request, 404, "not_found", "No matching financial period is available.", { retryable: false });
  return v1Response(request, data, {
    dataVersion: FINANCIAL_DATA_VERSION,
    asOf: data.period,
    retrievedAt: read.dataset.retrievedAt,
    currency: read.dataset.company.currency,
    status: data.sources.some((source) => source.status === "calculated") ? "calculated" : "reported",
    warnings: read.dataset.warnings,
  }, { cacheControl: V1_CACHE.financials });
}

