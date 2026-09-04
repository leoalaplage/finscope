import { fetchQuotes } from "@/lib/adapters/quotes";
import { V1_CACHE, v1Error, v1Response } from "@/lib/api/v1/http";
import { TICKER_PATTERN } from "@/lib/market-profile";

const MAX_SYMBOLS = 50;

export async function GET(request: Request) {
  const symbols = [...new Set((new URL(request.url).searchParams.get("symbols") ?? "")
    .split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length || symbols.length > MAX_SYMBOLS || symbols.some((symbol) => !TICKER_PATTERN.test(symbol))) {
    return v1Error(request, 400, "invalid_request", `symbols must contain 1 to ${MAX_SYMBOLS} valid exchange symbols.`, { retryable: false });
  }
  try {
    const found = await fetchQuotes(symbols);
    const bySymbol = new Map(found.map((quote) => [quote.symbol.toUpperCase(), quote]));
    const quotes = symbols.map((symbol) => {
      const quote = bySymbol.get(symbol);
      return quote ? { ...quote, symbol, status: quote.price == null ? "unavailable" as const : "reported" as const } : {
        symbol, name: symbol, price: null, previousClose: null, change: null, changePercent: null,
        currency: null, asOf: null, status: "unavailable" as const,
      };
    });
    const timestamps = quotes.map((quote) => quote.asOf).filter((value): value is string => value != null).sort();
    const missing = quotes.filter((quote) => quote.status === "unavailable").map((quote) => quote.symbol);
    return v1Response(request, { quotes }, {
      dataVersion: "market-quotes-v1",
      asOf: timestamps.at(-1) ?? null,
      retrievedAt: new Date().toISOString(),
      frequency: "live",
      status: missing.length === quotes.length ? "unavailable" : "reported",
      warnings: missing.length ? [`No current quote was returned for: ${missing.join(", ")}.`] : [],
    }, { cacheControl: V1_CACHE.quotes });
  } catch (error) {
    return v1Error(request, 502, "upstream_unavailable", error instanceof Error ? error.message : "Quotes are unavailable.");
  }
}

