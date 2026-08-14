export type CompanySortKey = "marketCap" | "fcfMargin" | "fcfShareCagr" | "revenueShareCagr" | "operatingMargin" | "dilution" | "pfcf" | "valuationVsAverage" | "updated" | "ticker"
  | "revenueCagr10" | "fcfCagr10" | "fcfVsRevenue10" | "fcfConsistency5" | "fcfConsistency10" | "fcfAfterSbcMargin";
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
  revenueCagr10: number | null;
  fcfCagr10: number | null;
  /** Free cash flow growth minus revenue growth over ten years, in points. */
  fcfVsRevenue10: number | null;
  fcfConsistency5: number | null;
  fcfConsistency10: number | null;
  fcfAfterSbcMargin: number | null;
  updated: string | null;
  loading?: boolean;
}

export type ColumnFormat = "currency" | "percent" | "ratio" | "points" | "score";

export interface CompanyColumn {
  key: Exclude<CompanySortKey, "ticker" | "updated">;
  label: string;
  format: ColumnFormat;
  /** Shown in the picker so a column explains itself before it is added. */
  hint: string;
}

/**
 * Every column the ranking table can show, in offer order. Columns are data,
 * not markup, so adding one is a line here rather than four edits in the view.
 */
export const COMPANY_COLUMNS: CompanyColumn[] = [
  { key: "marketCap", label: "Market Cap", format: "currency", hint: "Share price times shares outstanding." },
  { key: "fcfMargin", label: "FCF Margin", format: "percent", hint: "Free cash flow as a share of revenue." },
  { key: "fcfAfterSbcMargin", label: "FCF Margin after SBC", format: "percent", hint: "The same, treating stock compensation as the cost it is." },
  { key: "fcfShareCagr", label: "FCF/share CAGR 5Y", format: "percent", hint: "Compound growth in free cash flow per share." },
  { key: "revenueShareCagr", label: "Revenue/share CAGR 5Y", format: "percent", hint: "Compound growth in revenue per share." },
  { key: "revenueCagr10", label: "Revenue CAGR 10Y", format: "percent", hint: "Compound revenue growth over ten years." },
  { key: "fcfCagr10", label: "FCF CAGR 10Y", format: "percent", hint: "Compound free cash flow growth over ten years." },
  { key: "fcfVsRevenue10", label: "FCF vs Revenue 10Y", format: "points", hint: "Cash growth minus sales growth. Negative means sales grew faster than cash." },
  { key: "fcfConsistency5", label: "FCF consistency 5Y", format: "score", hint: "R² of a log-linear fit: 1.00 is perfectly steady compounding." },
  { key: "fcfConsistency10", label: "FCF consistency 10Y", format: "score", hint: "The same over ten years." },
  { key: "operatingMargin", label: "Operating Margin", format: "percent", hint: "Operating income as a share of revenue." },
  { key: "dilution", label: "Dilution 5Y", format: "percent", hint: "Change in diluted share count. Negative is buybacks." },
  { key: "pfcf", label: "P/FCF", format: "ratio", hint: "Market capitalisation over free cash flow." },
  { key: "valuationVsAverage", label: "Valuation vs AVG 5Y", format: "percent", hint: "Current P/FCF against its own five-year average." },
];

export const DEFAULT_COLUMNS: CompanySortKey[] = ["marketCap", "fcfMargin", "fcfShareCagr", "revenueShareCagr", "operatingMargin", "dilution", "pfcf", "valuationVsAverage"];

export interface CompanyFilters {
  query: string;
  minimumMarketCap: number | null;
  minimumFcfMargin: number | null;
  minimumFcfShareCagr: number | null;
  maximumDilution: number | null;
}

export const DEFAULT_COMPANY_SORT: { key: CompanySortKey; direction: SortDirection } = { key: "marketCap", direction: "desc" };
export const DEFAULT_COMPANY_FILTERS: CompanyFilters = { query: "", minimumMarketCap: null, minimumFcfMargin: null, minimumFcfShareCagr: null, maximumDilution: null };

/** Columns where a smaller number is the better one. */
const ASCENDING_IS_BETTER = new Set<CompanySortKey>(["dilution", "pfcf", "valuationVsAverage", "ticker"]);

export function preferredDirection(key: CompanySortKey): SortDirection {
  return ASCENDING_IS_BETTER.has(key) ? "asc" : "desc";
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
