import { readCompany, type CompanyReadResult } from "./company-repository";
import { FINANCIAL_DATA_VERSION } from "./contracts";
import { v1Error } from "./http";

type ReadyCompany = Extract<CompanyReadResult, { kind: "ready" }>;

export async function companyForRoute(
  request: Request,
  ticker: string,
): Promise<ReadyCompany | Response> {
  const result = await readCompany(ticker, new URL(request.url).origin);
  if (result.kind === "ready") return result;
  if (result.kind === "building") {
    return v1Error(request, 202, "data_building", "Financial data is being prepared. Retry shortly.", {
      retryable: true,
      details: { ticker: result.ticker },
      meta: { dataVersion: FINANCIAL_DATA_VERSION },
      headers: { "Retry-After": "3" },
    });
  }
  return v1Error(request, 503, "data_unavailable", result.reason, { retryable: true });
}
