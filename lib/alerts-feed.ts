import { filingAlerts, insiderAlerts, sortAlerts, type Alert } from "./alerts";
import { companyEvents } from "./company-events";
import { readInsiderBuying } from "./insider-buying";
import { companyByTicker } from "./company-registry";
import { universeMember } from "./universe";
import { sameListing, searchSecCompanies } from "./adapters/sec";

/**
 * The alerts for a set of companies since a date (lib/alerts.ts): each
 * company's events are the EVT panel's cached copy, six companies at a time.
 * Read by the ALRT page and by the daily email (lib/email-alerts.ts).
 */
async function cikOf(ticker: string): Promise<string | null> {
  const known = companyByTicker(ticker)?.cik ?? universeMember(ticker)?.cik;
  if (known) return known;
  const found = (await searchSecCompanies(ticker).catch(() => [])).find((entry) => sameListing(entry.ticker, ticker));
  return found?.cik ?? null;
}

export async function alertsFor(tickers: string[], since: string): Promise<{ alerts: Alert[]; failed: string[] }> {
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
  return { alerts: sortAlerts(alerts), failed };
}
