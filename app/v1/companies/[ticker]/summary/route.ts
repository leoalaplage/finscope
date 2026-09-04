import { companySummary } from "@/lib/api/v1/company";
import { companyForRoute } from "@/lib/api/v1/route-helpers";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";
import { FINANCIAL_DATA_VERSION } from "@/lib/api/v1/contracts";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const read = await companyForRoute(request, ticker);
  if (read instanceof Response) return read;
  const data = companySummary(read.dataset);
  if (!data) return v1Error(request, 404, "not_found", "No normalized financial period is available for this company.", { retryable: false });
  const warnings = [...read.dataset.warnings];
  if (read.cache === "previous-version") warnings.push("A previous compatible dataset version is being served while the current version is built.");
  return v1Response(request, data, {
    dataVersion: FINANCIAL_DATA_VERSION,
    asOf: data.latestPeriod.periodEnd,
    retrievedAt: read.dataset.retrievedAt,
    currency: read.dataset.company.currency,
    frequency: data.latestPeriod.frequency,
    status: "calculated",
    warnings,
  }, { cacheControl: read.cache === "current" ? V1_CACHE.financials : V1_CACHE.none });
}

