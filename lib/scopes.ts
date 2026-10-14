/** What a screen is run over: no server code here, so the pages can name the choices too (lib/listed-universe.ts). */
export type Scope = "sp500" | "us1000" | "all";
export const SCOPES: Array<{ id: Scope; label: string; note: string }> = [
  { id: "sp500", label: "S&P 500", note: "The index's members" },
  { id: "us1000", label: "US 1000", note: "The thousand largest US-listed companies by market value — a stand-in for the Russell 1000" },
  { id: "all", label: "All US", note: "Every operating company listed on the NYSE or Nasdaq that files with the SEC" },
];
export const isScope = (value: string | null | undefined): value is Scope => value === "sp500" || value === "us1000" || value === "all";
