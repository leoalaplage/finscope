import { NextResponse } from "next/server";
import { filingAlerts, insiderAlerts, sortAlerts, type Alert } from "@/lib/alerts";
import { companyEvents } from "@/lib/company-events";
import { readInsiderBuying } from "@/lib/insider-buying";
import { companyByTicker } from "@/lib/company-registry";
import { universeMember } from "@/lib/universe";
import { sameListing, searchSecCompanies } from "@/lib/adapters/sec";
import { TICKER_PATTERN } from "@/lib/market-profile";

/**
 * The alerts for the companies a reader follows, since a date (lib/alerts.ts).
 * Each company's events are the EVT panel's cached copy; sixty companies at
 * most, six at a time.
 */
async function cikOf(ticker: string): Promise<string | null> {
  const known = companyByTicker(ticker)?.cik ?? universeMember(ticker)?.cik;
  if (known) return known;
  const found = (await searchSecCompanies(ticker).catch(() => [])).find((entry) => sameListing(entry.ticker, ticker));
  return found?.cik ?? null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tickers = [...new Set((params.get("tickers") ?? "").split(",").map((ticker) => ticker.trim().toUpperCase()).filter((ticker) => TICKER_PATTERN.test(ticker)))].slice(0, 60);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(params.get("since") ?? "") ? params.get("since")! : new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  if (!tickers.length) return NextResponse.json({ since, alerts: [], failed: [] });
  const alerts: Alert[] = [];
  const failed: string[] = [];
  const queue = [...tickers];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const ticker = queue.shift()!;
      try {
        const cik = await cikOf(ticker);
        if (!cik) { failed.push(ticker); continue; }
        alerts.push(...filingAlerts(ticker, (await companyEvents(cik)).events, since));
      } catch {
        failed.push(ticker);
      }
    }
  }));
  const store = await readInsiderBuying();
  alerts.push(...insiderAlerts(store?.purchases ?? [], new Set(tickers), since));
  return NextResponse.json({ since, alerts: sortAlerts(alerts), failed }, { headers: { "Cache-Control": "public, max-age=120, s-maxage=300" } });
}
