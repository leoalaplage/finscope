import { parseForm4 } from "./adapters/insiders";
import { dailyIndexUrl, parseDailyIndex } from "./edgar-daily";
import { watchedCompanies } from "./filing-watch";
import { datasetCache } from "./runtime-env";

/**
 * Insiders buying their own company's shares in the open market, across the
 * index, and the clusters of them.
 *
 * A sale says little — pay, taxes, a house. A purchase with one's own money,
 * at the market's price, says one thing, and several officers and directors
 * doing it within the same fortnight says it louder: the most-studied insider
 * signal there is. The company page's INS panel reads one company's Form 4s
 * when it is opened; this reads every Form 4 the index's members file, from
 * EDGAR's daily index, a few dozen a run on the half-hourly timer, and keeps
 * the open-market purchases (transaction code P) of the last four months.
 */

export interface InsiderPurchase {
  ticker: string;
  cik: string;
  owner: string;
  role: string;
  /** The day of the trade. */
  date: string;
  /** The day the Form 4 was filed. */
  filed: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  sharesAfter: number | null;
  url: string;
}

export interface InsiderCluster {
  ticker: string;
  /** Distinct insiders who bought within the window. */
  buyers: number;
  from: string;
  to: string;
  value: number;
  purchases: InsiderPurchase[];
}

interface Pending { accession: string; cik: string; ticker: string; filed: string }
export interface InsiderBuyingStore {
  /** Daily indexes already queued, by date. */
  days: string[];
  queue: Pending[];
  /** Accessions read, so a filing listed twice (issuer and owner) is read once. */
  read: string[];
  purchases: InsiderPurchase[];
  updatedAt: string;
}

export const INSIDER_BUYING_KEY = "insider-buying:v1";
const KEEP_DAYS = 120;
const BACKFILL_DAYS = 45;
const PER_RUN = 45;
const SEC_AGENT = () => process.env.SEC_USER_AGENT || "FinScope research application contact@example.com";
const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function readInsiderBuying(): Promise<InsiderBuyingStore | null> {
  try {
    return (await datasetCache()?.get<InsiderBuyingStore>(INSIDER_BUYING_KEY, "json")) ?? null;
  } catch {
    return null;
  }
}

/**
 * One run: queue the daily indexes not yet queued (the last six weeks on the
 * first runs, the newest day after), then read the next few dozen Form 4s.
 */
export async function insiderBuyingSlice(now = new Date()): Promise<{ queued: number; read: number; purchases: number } | null> {
  const cache = datasetCache();
  if (!cache) return null;
  const store: InsiderBuyingStore = (await readInsiderBuying()) ?? { days: [], queue: [], read: [], purchases: [], updatedAt: "" };
  const watched = new Map(watchedCompanies().map((company) => [String(Number(company.cik)), company.ticker]));
  const done = new Set(store.days);
  let queued = 0;
  // Newest first, at most three new days a run, so the backfill spreads over runs.
  for (let back = 1; back <= BACKFILL_DAYS && queued < 3; back++) {
    const day = new Date(now.getTime() - back * DAY);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const date = iso(day);
    if (done.has(date)) continue;
    const response = await fetch(dailyIndexUrl(day), { headers: { "User-Agent": SEC_AGENT() } });
    if (response.status === 404 || response.status === 403) { await response.body?.cancel(); if (response.status === 404 && back > 3) store.days.push(date); continue; }
    if (!response.ok) { await response.body?.cancel(); continue; }
    const seen = new Set([...store.read, ...store.queue.map((entry) => entry.accession)]);
    for (const filing of parseDailyIndex(await response.text())) {
      if ((filing.form !== "4" && filing.form !== "4/A") || !watched.has(filing.cik) || seen.has(filing.accession)) continue;
      seen.add(filing.accession);
      store.queue.push({ accession: filing.accession, cik: filing.cik, ticker: watched.get(filing.cik)!, filed: date });
    }
    store.days.push(date);
    queued++;
  }

  let read = 0;
  const kept = new Set(store.read);
  while (store.queue.length && read < PER_RUN) {
    const next = store.queue.shift()!;
    read++;
    const url = `https://www.sec.gov/Archives/edgar/data/${next.cik}/${next.accession}.txt`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": SEC_AGENT() } });
      if (response.status === 429 || response.status === 403 || response.status >= 500) {
        // Refused: back on the queue for the next run, and this run stops asking.
        await response.body?.cancel();
        store.queue.unshift(next);
        break;
      }
      if (!response.ok) { await response.body?.cancel(); kept.add(next.accession); continue; }
      const text = await response.text();
      // The filing is listed under every party to it: keep it only where this company is the issuer.
      const issuer = /<issuerCik>\s*0*(\d+)\s*<\/issuerCik>/.exec(text)?.[1];
      kept.add(next.accession);
      if (issuer !== next.cik) continue;
      const index = `https://www.sec.gov/Archives/edgar/data/${next.cik}/${next.accession.replace(/-/g, "")}/${next.accession}-index.htm`;
      for (const trade of parseForm4(text, next.accession, next.filed, index)) {
        if (trade.code !== "P" || trade.direction !== "acquired") continue;
        store.purchases.push({
          ticker: next.ticker, cik: next.cik, owner: trade.owner, role: trade.role, date: trade.date, filed: next.filed,
          shares: trade.shares, price: trade.price, value: trade.value, sharesAfter: trade.sharesAfter, url: index,
        });
      }
    } catch {
      store.queue.unshift(next);
      break;
    }
  }

  const horizon = iso(new Date(now.getTime() - KEEP_DAYS * DAY));
  store.purchases = store.purchases.filter((purchase) => purchase.date >= horizon).sort((left, right) => right.date.localeCompare(left.date));
  store.days = store.days.filter((date) => date >= horizon);
  store.read = [...kept].slice(-6000);
  store.updatedAt = now.toISOString();
  await cache.put(INSIDER_BUYING_KEY, JSON.stringify(store));
  return { queued, read, purchases: store.purchases.length };
}

/**
 * Purchases by at least two different insiders of one company within a
 * fortnight, the largest run of them per company, newest first. Pure.
 */
export function insiderClusters(purchases: InsiderPurchase[], windowDays = 14, minimum = 2): InsiderCluster[] {
  const byTicker = new Map<string, InsiderPurchase[]>();
  for (const purchase of purchases) byTicker.set(purchase.ticker, [...(byTicker.get(purchase.ticker) ?? []), purchase]);
  const clusters: InsiderCluster[] = [];
  for (const [ticker, list] of byTicker) {
    const sorted = [...list].sort((left, right) => left.date.localeCompare(right.date));
    let best: InsiderCluster | null = null;
    for (let start = 0; start < sorted.length; start++) {
      const end = Date.parse(sorted[start].date) + windowDays * DAY;
      const inside = sorted.filter((purchase, index) => index >= start && Date.parse(purchase.date) <= end);
      const buyers = new Set(inside.map((purchase) => purchase.owner.toUpperCase())).size;
      if (buyers < minimum) continue;
      const cluster = { ticker, buyers, from: inside[0].date, to: inside.at(-1)!.date, value: inside.reduce((sum, purchase) => sum + (purchase.value ?? 0), 0), purchases: inside };
      if (!best || cluster.buyers > best.buyers || (cluster.buyers === best.buyers && cluster.to > best.to)) best = cluster;
    }
    if (best) clusters.push(best);
  }
  return clusters.sort((left, right) => right.to.localeCompare(left.to) || right.buyers - left.buyers);
}
