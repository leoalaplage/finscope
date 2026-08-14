export type CompanySortKey = "marketCap" | "fcfMargin" | "fcfShareCagr" | "revenueShareCagr" | "operatingMargin" | "dilution" | "pfcf" | "valuationVsAverage" | "updated" | "ticker";
export type SortDirection = "asc" | "desc";

export interface CompanyRankingRow {
  ticker: string;
  marketCap: number | null;
  fcfMargin: number | null;
  fcfShareCagr: number | null;
  revenueShareCagr: number | null;
  operatingMargin: number | null;
  dilution: number | null;
  pfcf: number | null;
  valuationVsAverage: number | null;
  updated: string | null;
  loading?: boolean;
}

export interface CompanyFilters {
  query: string;
  minimumMarketCap: number | null;
  minimumFcfMargin: number | null;
  minimumFcfShareCagr: number | null;
  maximumDilution: number | null;
}

export const DEFAULT_COMPANY_SORT: { key: CompanySortKey; direction: SortDirection } = { key: "marketCap", direction: "desc" };
export const DEFAULT_COMPANY_FILTERS: CompanyFilters = { query: "", minimumMarketCap: null, minimumFcfMargin: null, minimumFcfShareCagr: null, maximumDilution: null };

export function preferredDirection(key: CompanySortKey): SortDirection {
  return key === "dilution" || key === "pfcf" || key === "valuationVsAverage" || key === "ticker" ? "asc" : "desc";
}

function numericValue(row: CompanyRankingRow, key: CompanySortKey) {
  if (key === "updated") return row.updated ? Date.parse(`${row.updated.slice(0, 10)}T00:00:00Z`) : null;
  if (key === "ticker") return null;
  return row[key];
}

export function sortCompanyRows<T extends CompanyRankingRow>(rows: T[], key: CompanySortKey, direction: SortDirection): T[] {
  return [...rows].sort((left, right) => {
    if (key === "ticker") return direction === "asc" ? left.ticker.localeCompare(right.ticker) : right.ticker.localeCompare(left.ticker);
    const leftValue = numericValue(left, key); const rightValue = numericValue(right, key);
    const leftMissing = left.loading || leftValue == null || !Number.isFinite(leftValue);
    const rightMissing = right.loading || rightValue == null || !Number.isFinite(rightValue);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (!leftMissing && !rightMissing && leftValue !== rightValue) return direction === "asc" ? leftValue! - rightValue! : rightValue! - leftValue!;
    const capDifference = (right.marketCap ?? -Infinity) - (left.marketCap ?? -Infinity);
    return capDifference || left.ticker.localeCompare(right.ticker);
  });
}

export function filterCompanyRows<T extends CompanyRankingRow>(rows: T[], filters: CompanyFilters): T[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (query && !row.ticker.toLowerCase().includes(query)) return false;
    if (filters.minimumMarketCap != null && (row.marketCap == null || row.marketCap < filters.minimumMarketCap)) return false;
    if (filters.minimumFcfMargin != null && (row.fcfMargin == null || row.fcfMargin < filters.minimumFcfMargin)) return false;
    if (filters.minimumFcfShareCagr != null && (row.fcfShareCagr == null || row.fcfShareCagr < filters.minimumFcfShareCagr)) return false;
    if (filters.maximumDilution != null && (row.dilution == null || row.dilution > filters.maximumDilution)) return false;
    return true;
  });
}
