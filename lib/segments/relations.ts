import { datasetCache } from "../runtime-env";
import type { Customer } from "./customers";

/**
 * Who supplies whom, across the index: each company's named customers turned
 * round, so a customer's page lists the companies that name it.
 *
 * A company's customers are read with its segments (lib/segments/source.ts)
 * and only by that build; the other direction needs every other company's.
 * Each build leaves one small key a company, `customers:v1:{TICKER}`, whose
 * metadata holds the index members it names. KV lists keys with their
 * metadata, a thousand to a call, so the whole index's edges come back in one
 * request and nothing has to be rebuilt in step: a company that stops naming
 * a customer drops the edge the next time it is built, and a company not
 * built for a month drops out with its key.
 */

const PREFIX = "customers:v1:";
/** As long as the segments themselves are kept (lib/segments/store.ts). */
const KEEP_SECONDS = 30 * 86_400;

/** One named customer as the supplier's latest report gives it: [customer, share of revenue, year end, share of receivables, balance date]. */
export type Edge = [string, number | null, string | null, number | null, string | null];

export interface Supplier {
  ticker: string;
  /** The customer's share of the supplier's revenue, its latest fiscal year. */
  share: number | null;
  end: string | null;
  /** Its share of the supplier's receivables, where the supplier states that. */
  receivables: number | null;
  receivablesEnd: string | null;
}

/** The index members a company names, each with its latest figures. A KV key's metadata holds 1,024 bytes; a dozen edges fit. */
export function edgesOf(customers: Customer[]): Edge[] {
  return customers.filter((customer) => customer.ticker).slice(0, 12).map((customer) => {
    const year = [...customer.annual].reverse().find((point) => point.share != null) ?? null;
    const balance = customer.receivables.at(-1) ?? null;
    const round = (value: number | null | undefined) => (value == null ? null : Math.round(value * 10_000) / 10_000);
    return [customer.ticker!, round(year?.share), year?.end ?? null, round(balance?.share), balance?.end ?? null];
  });
}

export async function recordCustomers(ticker: string, customers: Customer[]): Promise<void> {
  const edges = edgesOf(customers);
  await datasetCache()?.put(`${PREFIX}${ticker.toUpperCase()}`, String(customers.length), { metadata: { e: edges }, expirationTtl: KEEP_SECONDS }).catch(() => undefined);
}

/** Every company's edges, read once an isolate every ten minutes. */
let held: { at: number; edges: Map<string, Edge[]>; companies: number } | null = null;
const FRESH_MS = 10 * 60_000;

export async function allEdges(): Promise<{ edges: Map<string, Edge[]>; companies: number }> {
  if (held && Date.now() - held.at < FRESH_MS) return held;
  const cache = datasetCache();
  const edges = new Map<string, Edge[]>();
  if (!cache) return { edges, companies: 0 };
  let cursor: string | undefined;
  let companies = 0;
  do {
    const page: KVNamespaceListResult<{ e?: Edge[] }> = await cache.list<{ e?: Edge[] }>({ prefix: PREFIX, cursor });
    for (const key of page.keys) {
      companies++;
      edges.set(key.name.slice(PREFIX.length), key.metadata?.e ?? []);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  held = { at: Date.now(), edges, companies };
  return held;
}

/** The companies whose latest reports name this one as a customer, the largest share first. */
export function suppliersFrom(edges: Map<string, Edge[]>, ticker: string): Supplier[] {
  const wanted = ticker.toUpperCase();
  const out: Supplier[] = [];
  for (const [supplier, list] of edges) {
    const edge = list.find(([customer]) => customer === wanted);
    if (edge && supplier !== wanted) out.push({ ticker: supplier, share: edge[1], end: edge[2], receivables: edge[3], receivablesEnd: edge[4] });
  }
  return out.sort((left, right) => (right.share ?? right.receivables ?? 0) - (left.share ?? left.receivables ?? 0) || left.ticker.localeCompare(right.ticker));
}
